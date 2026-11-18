/**
 * Service worker: schedules polling rounds, runs jobs politely, groups new
 * listings into the inbox, and shows notifications. It is the only writer of
 * storage; pages talk to it with chrome.runtime messages.
 */
import {
  clearableIds,
  emptyInbox,
  ingest,
  list,
  markAllRead,
  markRead,
  prune,
  remove,
  setStarred,
  unreadCount,
} from './lib/inbox.js';
import { runJob } from './lib/job.js';
import {
  GAP_MS,
  clearCooldowns,
  enqueueRound,
  finishJob,
  isBaseline,
  pickJob,
  retain,
  startJob,
} from './lib/schedule.js';
import {
  applySettingsChange,
  normalizeSettings,
  siteEnabled,
} from './lib/settings.js';
import { createStore } from './lib/store.js';
import {
  cacheThumbs,
  staleThumbs,
  thumbsToFetch,
  toDataUrl,
} from './lib/thumbs.js';
import { ADAPTERS, adapterById, SITE_NAMES } from './sites/index.js';
import { formatDates } from './ui/format.js';

const store = createStore(chrome.storage.local);
const INBOX_URL = chrome.runtime.getURL('src/ui/inbox.html');
const OFFSCREEN_URL = 'src/offscreen.html';
const ICON = chrome.runtime.getURL('icons/icon128.png');
const PUMP_BUDGET_MS = 4 * 60_000;
const SHORT_WAIT_MS = 20_000;

const sleep = (/** @type {number} */ ms) =>
  new Promise((r) => setTimeout(r, ms));
const todayIso = () => new Date().toISOString().slice(0, 10);
/** @param {string} what @param {unknown} error */
const warn = (what, error) =>
  console.warn(
    `[live-notifier] ${what}:`,
    String(/** @type {Error} */ (error)?.message ?? error)
  );

// ---------------------------------------------------------------- alarms

async function ensureAlarm() {
  const { settings } = await store.read();
  const current = await chrome.alarms.get('round');
  if (!current || current.periodInMinutes !== settings.intervalMinutes) {
    await chrome.alarms.create('round', {
      delayInMinutes: 1,
      periodInMinutes: settings.intervalMinutes,
    });
  }
}

/**
 * Queue every keyword on every enabled site, then work the queue.
 *
 * @param {string[]} [keywords] only these (default: every keyword)
 * @param {{ retry?: boolean }} [options] `retry`: end site cooldowns first
 *   (the user asked; they may just have passed a site's bot check)
 */
async function startRound(keywords, { retry = false } = {}) {
  const now = Date.now();
  await store.update('schedule', (schedule, { settings }) => {
    const sites = ADAPTERS.filter((a) => siteEnabled(settings, a.id)).map(
      (a) => a.id
    );
    const kept = retain(retry ? clearCooldowns(schedule) : schedule, {
      keywords: settings.keywords,
      sites,
    });
    return {
      value: enqueueRound(kept, {
        keywords: keywords ?? settings.keywords,
        sites,
        now,
      }),
    };
  });
  await store.update('inbox', (inbox) => ({
    value: prune(inbox, { today: todayIso() }),
  }));
  void pump();
}

// ---------------------------------------------------------------- parsing

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_PARSER'],
      justification: 'Parse ticket-site search result pages',
    })
    .catch((error) => {
      if (!String(error).includes('single offscreen')) throw error;
    });
}

/** @type {import('./lib/job.js').ParseFn} */
async function parseAnywhere(adapter, text, ctx) {
  if (adapter.format === 'json') return adapter.parse(JSON.parse(text), ctx);
  await ensureOffscreen();
  const reply = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'parse',
    site: adapter.id,
    text,
    ctx: { ...ctx, now: ctx.now.toISOString() },
  });
  if (!reply || reply.error)
    throw new Error(reply?.error ?? 'offscreen did not answer');
  return reply.listings;
}

/**
 * Clear a site's bot check by loading the page in a background tab (a real
 * page load runs the check and stores its cookie), then, after the per-site
 * gap, fetch again from the service worker with that cookie. Falls back to
 * the tab's own HTML when the second fetch is still refused.
 *
 * @param {string} url
 * @param {RequestInit | undefined} init
 * @param {RegExp | undefined} expect marker of a genuine results page
 * @returns {Promise<Response>}
 */
async function fetchViaTab(url, init, expect) {
  const looksOk = (/** @type {string} */ html) =>
    Boolean(html) &&
    (expect
      ? expect.test(html)
      : !/awsWafCookieDomainList|AwsWafIntegration|challenge-platform/.test(
          html.slice(0, 20_000)
        ));
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = /** @type {number} */ (tab.id);
  let tabHtml = '';
  try {
    for (let i = 0; i < 20 && !tabHtml; i++) {
      await sleep(1_500);
      const [result] = await chrome.scripting
        .executeScript({
          target: { tabId },
          func: () =>
            document.readyState === 'complete'
              ? document.documentElement.outerHTML
              : '',
        })
        .catch(() => [{ result: '' }]);
      const html = /** @type {string} */ (result?.result ?? '');
      if (looksOk(html)) tabHtml = html;
    }
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  if (!tabHtml) return new Response('', { status: 503 });
  // The tab's page load was a request to the site too: keep the per-site gap
  // before the refetch.
  await sleep(GAP_MS);
  const again = await fetch(url, { credentials: 'include', ...init }).catch(
    () => null
  );
  const text = again?.ok ? await again.text() : '';
  return new Response(looksOk(text) ? text : tabHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// ---------------------------------------------------------------- posters

/** Longest side of a stored poster (the inbox shows it at most 240 px high). */
const THUMB_PX = 480;

/**
 * Shrink an image to THUMB_PX on its longest side, as a WebP data URL.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function shrink(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (
    canvas.getContext('2d')
  );
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  return toDataUrl(new Uint8Array(await out.arrayBuffer()), 'image/webp');
}

/**
 * After a successful job on a bot-checked site, store the posters its
 * concerts show while the site's pass is fresh (see lib/thumbs.js).
 *
 * @param {import('./lib/inbox.js').Listing[]} listings
 */
async function storePosters(listings) {
  const { inbox } = await store.read();
  const have = new Set(await chrome.storage.local.getKeys());
  await cacheThumbs(thumbsToFetch(inbox, listings, have), {
    fetch: (url, init) => fetch(url, init),
    shrink,
    save: (items) => chrome.storage.local.set(items),
  });
}

/**
 * Delete stored posters no concert shows any more.
 *
 * @param {import('./lib/inbox.js').InboxState | undefined} inbox
 */
async function sweepPosters(inbox) {
  const stale = staleThumbs(await chrome.storage.local.getKeys(), {
    ...emptyInbox(),
    ...inbox,
  });
  if (stale.length) await chrome.storage.local.remove(stale);
}

// ---------------------------------------------------------------- the queue

let pumping = false;

/** Work queued jobs until the queue is empty, waits are long, or time runs out. */
async function pump() {
  if (pumping) return;
  pumping = true;
  const started = Date.now();
  /** @type {Map<string, number>} keyword → baseline concerts found */
  const baselines = new Map();
  try {
    while (Date.now() - started < PUMP_BUDGET_MS) {
      const now = Date.now();
      const pick = await store.update(
        'schedule',
        /**
         * @param {import('./lib/schedule.js').ScheduleState} schedule
         * @returns {{
         *   value: import('./lib/schedule.js').ScheduleState,
         *   result: { job: import('./lib/schedule.js').Job, index: number, baseline: boolean } | { waitMs: number } | null,
         * }}
         */
        (schedule) => {
          const p = pickJob(schedule, now);
          if (!p || !('job' in p)) return { value: schedule, result: p };
          return {
            value: startJob(schedule, p.index, now),
            result: { ...p, baseline: isBaseline(schedule, p.job) },
          };
        }
      );
      if (!pick) break;
      if (!('job' in pick)) {
        if (pick.waitMs <= SHORT_WAIT_MS) {
          await sleep(pick.waitMs);
          continue;
        }
        await chrome.alarms.create('pump', { when: Date.now() + pick.waitMs });
        break;
      }
      await runOne(pick.job, pick.baseline, baselines);
    }
    if (Date.now() - started >= PUMP_BUDGET_MS)
      await chrome.alarms.create('pump', { delayInMinutes: 1 });
  } catch (error) {
    // Something unexpected (storage, a bug) stopped this run: the rest of the
    // queue must not wait for the next round.
    warn('pump stopped', error);
    await chrome.alarms
      .create('pump', { delayInMinutes: 1 })
      .catch((e) => warn('could not reschedule the pump', e));
  } finally {
    pumping = false;
    await notifyBaselines(baselines).catch((e) =>
      warn('baseline notification failed', e)
    );
  }
}

/**
 * @param {import('./lib/schedule.js').Job} job
 * @param {boolean} baseline
 * @param {Map<string, number>} baselines
 */
async function runOne(job, baseline, baselines) {
  const adapter = adapterById(job.site);
  if (!adapter) return;
  const { settings } = await store.read();
  const fetchFn = /** @type {import('./lib/job.js').FetchFn} */ (
    (url, init) => fetch(url, init)
  );
  // The job is already off the queue: whatever goes wrong must still end in
  // finishJob (failure count, cooldown), or the pump would stop here.
  const attempt = (/** @type {import('./lib/job.js').FetchFn} */ f) =>
    runJob({
      adapter,
      keyword: job.keyword,
      now: new Date(),
      fetch: f,
      parse: parseAnywhere,
    }).catch((error) => ({
      outcome: /** @type {const} */ ({
        kind: 'error',
        error: String(error?.message ?? error),
      }),
      listings: [],
    }));
  let result = await attempt(fetchFn);
  const mayBeBlock =
    result.outcome.kind === 'blocked' ||
    (result.outcome.kind === 'error' && adapter.protection);
  if (mayBeBlock && settings.tabFallback && adapter.format === 'html') {
    // Keep the per-site gap before asking the site again.
    await sleep(GAP_MS);
    result = await attempt((url, init) =>
      fetchViaTab(url, init, adapter.expect)
    );
  }
  const now = new Date().toISOString();
  const changes = await store.update('inbox', (inbox) => {
    if (result.outcome.kind !== 'ok')
      return { value: inbox, result: { created: [], updated: [] } };
    const r = ingest(inbox, {
      keyword: job.keyword,
      listings: result.listings,
      now,
      baseline,
      siteNames: SITE_NAMES,
    });
    return {
      value: r.state,
      result: { created: r.created, updated: r.updated },
    };
  });
  // Posters are best effort: a failure must not keep the job from finishing.
  if (result.outcome.kind === 'ok' && adapter.protection)
    await storePosters(result.listings).catch((e) =>
      warn('storing posters failed', e)
    );
  await store.update('schedule', (schedule) => ({
    value: finishJob(schedule, job, result.outcome, Date.now()),
  }));
  if (baseline) {
    baselines.set(
      job.keyword,
      (baselines.get(job.keyword) ?? 0) + (changes?.created.length ?? 0)
    );
  } else if (changes) {
    // Notifications are best effort (the user can turn them off for Chrome):
    // the listings are already in the inbox, and the queue goes on.
    await notifyNew(changes.created, changes.updated).catch((e) =>
      warn('notification failed', e)
    );
  }
}

// ---------------------------------------------------------------- notifications

/**
 * @param {string[]} created
 * @param {string[]} updated
 */
async function notifyNew(created, updated) {
  const { settings, inbox } = await store.read();
  if (!settings.notify) return;
  const fresh = created.map((id) => inbox.concerts[id]).filter(Boolean);
  const changed = settings.notifyUpdates
    ? updated.map((id) => inbox.concerts[id]).filter(Boolean)
    : [];
  if (fresh.length > 3) {
    await chrome.notifications.create(`summary:${Date.now()}`, {
      type: 'list',
      iconUrl: ICON,
      title: `${fresh.length} new lives`,
      message: '',
      items: fresh
        .slice(0, 5)
        .map((c) => ({ title: c.keywords.join(', '), message: c.title })),
      priority: 1,
    });
  } else {
    for (const c of fresh) await notifyConcert(c, null);
  }
  for (const c of changed) await notifyConcert(c, c.update);
}

/**
 * @param {import('./lib/inbox.js').Concert} c
 * @param {string | null} update
 */
async function notifyConcert(c, update) {
  const where = [
    c.venue,
    c.prefecture && !c.venue?.includes(c.prefecture) ? c.prefecture : null,
  ]
    .filter(Boolean)
    .join(' · ');
  await chrome.notifications.create(`c:${c.id}:${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: update
      ? `${update} — ${c.keywords.join(', ')}`
      : `New live: ${c.keywords.join(', ')}`,
    message: c.title,
    contextMessage:
      [formatDates(c.dates, c.time), where].filter(Boolean).join('  ') ||
      [...new Set(c.offers.map((o) => SITE_NAMES[o.site]))].join(' / '),
    priority: 1,
  });
}

/** @param {Map<string, number>} baselines */
async function notifyBaselines(baselines) {
  const { settings } = await store.read();
  const found = [...baselines].filter(([, n]) => n > 0);
  if (!settings.notify || found.length === 0) return;
  await chrome.notifications.create(`summary:${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: 'Now watching',
    message: found.map(([k, n]) => `${k}: ${n} current listing(s)`).join('\n'),
    contextMessage: 'Already on sale; you will be notified about new ones.',
    priority: 0,
  });
}

/** @param {string} [hash] */
async function openInbox(hash = '') {
  const url = `${INBOX_URL}${hash ? `#${hash}` : ''}`;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  const open = contexts.find(
    (c) => c.documentUrl?.startsWith(INBOX_URL) && c.tabId !== -1
  );
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true, url });
    if (open.windowId !== -1)
      await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  await chrome.notifications.clear(notificationId);
  const [kind, id] = notificationId.split(':');
  if (kind === 'c') {
    await store.update('inbox', (inbox) => ({ value: markRead(inbox, id) }));
    await openInbox(id);
  } else {
    await openInbox('unread');
  }
});

// ---------------------------------------------------------------- badge

async function updateBadge() {
  const { inbox } = await store.read();
  const n = unreadCount(inbox);
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({
    text: n === 0 ? '' : n > 99 ? '99+' : String(n),
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.inbox) return;
  void updateBadge();
  void sweepPosters(
    /** @type {import('./lib/inbox.js').InboxState | undefined} */ (
      changes.inbox.newValue
    )
  ).catch((e) => warn('sweeping posters failed', e));
});

// ---------------------------------------------------------------- messages

/** @type {Record<string, (msg: any) => Promise<unknown>>} */
const handlers = {
  checkNow: async () => startRound(undefined, { retry: true }),
  open: async ({ id }) => {
    await store.update('inbox', (inbox) => ({ value: markRead(inbox, id) }));
    await openInbox(id);
  },
  openInbox: async ({ hash }) => openInbox(hash),
  read: async ({ id, read }) =>
    store.update('inbox', (inbox) => ({ value: markRead(inbox, id, read) })),
  readAll: async () =>
    store.update('inbox', (inbox) => ({ value: markAllRead(inbox) })),
  star: async ({ id, starred }) =>
    store.update('inbox', (inbox) => ({
      value: setStarred(inbox, id, starred),
    })),
  delete: async ({ ids }) =>
    store.update('inbox', (inbox) => ({ value: remove(inbox, ids) })),
  clearRead: async () =>
    store.update('inbox', (inbox) => {
      const ids = clearableIds(inbox);
      return { value: remove(inbox, ids), result: ids.length };
    }),
  // One edit, applied to the settings stored when its turn comes (store
  // updates run one at a time), so concurrent edits all survive.
  changeSettings: async ({ change }) => {
    const changed = await store.update('settings', (before) => {
      const next = normalizeSettings(applySettingsChange(before, change));
      return { value: next, result: { before, next } };
    });
    const { before, next } =
      /** @type {{ before: import('./lib/settings.js').Settings, next: import('./lib/settings.js').Settings }} */ (
        changed
      );
    await ensureAlarm();
    const added = next.keywords.filter((k) => !before.keywords.includes(k));
    const sitesOn = ADAPTERS.some(
      (a) => siteEnabled(next, a.id) && !siteEnabled(before, a.id)
    );
    if (sitesOn) await startRound();
    else if (added.length > 0) await startRound(added);
    else
      await store.update('schedule', (s) => ({
        value: retain(s, {
          keywords: next.keywords,
          sites: ADAPTERS.filter((a) => siteEnabled(next, a.id)).map(
            (a) => a.id
          ),
        }),
      }));
    return next;
  },
  recent: async ({ limit = 30 }) =>
    list((await store.read()).inbox).slice(0, limit),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (error) =>
      sendResponse({ ok: false, error: String(error?.message ?? error) })
  );
  return true;
});

// ---------------------------------------------------------------- lifecycle

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'round') void startRound();
  if (alarm.name === 'pump') void pump();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarm();
  await updateBadge();
  if (reason === 'install') await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await updateBadge();
  void pump();
});
