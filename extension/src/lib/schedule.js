/**
 * Polling schedule, kept polite: a queue of (keyword × site) jobs, at most one
 * request per site at a time with a minimum gap, and an exponential cooldown
 * for a site that blocks us or keeps failing. Pure functions over
 * ScheduleState; the service worker persists it between runs.
 */

/**
 * @typedef {{ keyword: string, site: string }} Job
 *
 * @typedef {{
 *   lastRequestAt: number,
 *   cooldownUntil: number,
 *   failures: number,
 *   lastOkAt: number | null,
 *   lastError: string | null,
 *   lastCount: number | null,
 * }} SiteHealth
 *
 * @typedef {{
 *   queue: Job[],
 *   sites: Record<string, SiteHealth>,
 *   synced: Record<string, number>,
 *   lastRunAt: number | null,
 *   log: Array<{ at: number, site: string, keyword: string, kind: Outcome['kind'], count: number | null, error: string | null }>,
 * }} ScheduleState  `log` keeps the last LOG_SIZE job results for the settings page
 *
 * @typedef {{ kind: 'ok', count: number } | { kind: 'blocked', error: string } | { kind: 'error', error: string }} Outcome
 */

export const GAP_MS = 3_000;
export const LOG_SIZE = 60;
const MINUTE = 60_000;
const BLOCKED_BASE = 30 * MINUTE;
const ERROR_BASE = 10 * MINUTE;
const MAX_COOLDOWN = 24 * 60 * MINUTE;

/** @returns {ScheduleState} */
export const emptySchedule = () => ({
  queue: [],
  sites: {},
  synced: {},
  lastRunAt: null,
  log: [],
});

/** @returns {SiteHealth} */
const freshHealth = () => ({
  lastRequestAt: 0,
  cooldownUntil: 0,
  failures: 0,
  lastOkAt: null,
  lastError: null,
  lastCount: null,
});

/** @param {string} keyword @param {string} site */
export const syncKey = (keyword, site) => `${site}|${keyword}`;

/**
 * Queue a full round: every keyword on every site, interleaved by keyword so
 * the requests to one site are spread across the round. Jobs already queued
 * are not added twice.
 *
 * @param {ScheduleState} state
 * @param {{ keywords: string[], sites: string[], now: number }} input
 * @returns {ScheduleState}
 */
export function enqueueRound(state, { keywords, sites, now }) {
  const queued = new Set(state.queue.map((j) => syncKey(j.keyword, j.site)));
  const queue = [...state.queue];
  for (const keyword of keywords) {
    for (const site of sites) {
      const key = syncKey(keyword, site);
      if (!queued.has(key)) {
        queue.push({ keyword, site });
        queued.add(key);
      }
    }
  }
  return { ...state, queue, lastRunAt: now };
}

/**
 * Drop queued jobs for keywords or sites that are no longer active.
 *
 * @param {ScheduleState} state
 * @param {{ keywords: string[], sites: string[] }} active
 * @returns {ScheduleState}
 */
export function retain(state, { keywords, sites }) {
  return {
    ...state,
    queue: state.queue.filter(
      (j) => keywords.includes(j.keyword) && sites.includes(j.site)
    ),
  };
}

/**
 * End every site's cooldown (a manual "Check now": the user may just have
 * passed the site's bot check). The failure count stays, so a site that
 * blocks again still backs off longer.
 *
 * @param {ScheduleState} state
 * @returns {ScheduleState}
 */
export function clearCooldowns(state) {
  return {
    ...state,
    sites: Object.fromEntries(
      Object.entries(state.sites).map(([id, h]) => [
        id,
        { ...h, cooldownUntil: 0 },
      ])
    ),
  };
}

/**
 * The first queued job whose site may be asked now, or how long to wait for
 * the soonest one. Jobs of a cooling-down site wait in the queue.
 *
 * @param {ScheduleState} state
 * @param {number} now
 * @param {number} [gap]
 * @returns {{ job: Job, index: number } | { waitMs: number } | null} null when the queue is empty
 */
export function pickJob(state, now, gap = GAP_MS) {
  if (state.queue.length === 0) return null;
  let soonest = Infinity;
  for (let index = 0; index < state.queue.length; index++) {
    const job = state.queue[index];
    const h = state.sites[job.site] ?? freshHealth();
    const readyAt = Math.max(h.cooldownUntil, h.lastRequestAt + gap);
    if (readyAt <= now) return { job, index };
    soonest = Math.min(soonest, readyAt - now);
  }
  return { waitMs: soonest };
}

/**
 * Take a job off the queue and stamp its site's request time.
 *
 * @param {ScheduleState} state
 * @param {number} index
 * @param {number} now
 * @returns {ScheduleState}
 */
export function startJob(state, index, now) {
  const job = state.queue[index];
  const h = state.sites[job.site] ?? freshHealth();
  return {
    ...state,
    queue: state.queue.filter((_, i) => i !== index),
    sites: { ...state.sites, [job.site]: { ...h, lastRequestAt: now } },
  };
}

/**
 * Record how a job went and restamp its site's request time. A block (403/429/challenge page) cools the site
 * down for 30 min, doubling per failure; other errors for 10 min, doubling;
 * both capped at 24 h. A success resets the count and marks the keyword as
 * synced on that site (later results are no longer a baseline).
 *
 * @param {Omit<ScheduleState, 'log'> & { log?: ScheduleState['log'] }} saved
 *   `log` is missing in states saved before it existed
 * @param {Job} job
 * @param {Outcome} outcome
 * @param {number} now
 * @returns {ScheduleState}
 */
export function finishJob(saved, job, outcome, now) {
  // A job may send several requests; the gap to the next job on this site
  // counts from the end of this one, not from its start.
  const h = { ...(saved.sites[job.site] ?? freshHealth()), lastRequestAt: now };
  const entry = {
    at: now,
    site: job.site,
    keyword: job.keyword,
    kind: outcome.kind,
    count: outcome.kind === 'ok' ? outcome.count : null,
    error: outcome.kind === 'ok' ? null : outcome.error,
  };
  /** @type {ScheduleState} */
  const state = {
    ...saved,
    log: [...(saved.log ?? []), entry].slice(-LOG_SIZE),
  };
  if (outcome.kind === 'ok') {
    return {
      ...state,
      sites: {
        ...state.sites,
        [job.site]: {
          ...h,
          failures: 0,
          cooldownUntil: 0,
          lastOkAt: now,
          lastError: null,
          lastCount: outcome.count,
        },
      },
      synced: { ...state.synced, [syncKey(job.keyword, job.site)]: now },
    };
  }
  const failures = h.failures + 1;
  const base = outcome.kind === 'blocked' ? BLOCKED_BASE : ERROR_BASE;
  const cooldown = Math.min(base * 2 ** (failures - 1), MAX_COOLDOWN);
  return {
    ...state,
    sites: {
      ...state.sites,
      [job.site]: {
        ...h,
        failures,
        cooldownUntil: now + cooldown,
        lastError: outcome.error,
      },
    },
  };
}

/**
 * Whether results for this keyword on this site would be the first sync.
 *
 * @param {ScheduleState} state
 * @param {Job} job
 */
export const isBaseline = (state, job) =>
  !(syncKey(job.keyword, job.site) in state.synced);
