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
  setTicket,
  ticketStart,
  unreadCount,
} from './lib/inbox.js';
import { runJob } from './lib/job.js';
import { findPosters } from './lib/poster.js';
import { noteText, plural, t } from './lib/i18n.js';
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
import { applySettingsChange, normalizeSettings } from './lib/settings.js';
import { createStore } from './lib/store.js';
import {
  cacheThumbs,
  staleThumbs,
  thumbsToFetch,
  toDataUrl,
} from './lib/thumbs.js';
import { ADAPTERS, adapterById, adapterOn, SITE_NAMES } from './sites/index.js';
import { formatDates } from './ui/format.js';

const store = createStore(chrome.storage.local);
const INBOX_URL = chrome.runtime.getURL('src/ui/inbox.html');
const OFFSCREEN_URL = 'src/offscreen.html';
const ICON = chrome.runtime.getURL('icons/icon128.png');
const PUMP_BUDGET_MS = 4 * 60_000;
const SHORT_WAIT_MS = 20_000;
const TICKET_ALARM = 'ticket-reminder';
const HOUR_MS = 3_600_000;
const TICKET_LEAD_MS = 24 * HOUR_MS;

const sleep = (/** @type {number} */ ms) =>
  new Promise((r) => setTimeout(r, ms));
const todayIso = () => new Date().toISOString().slice(0, 10);
/** @param {string} what @param {unknown} error */
const warn = (what, error) =>
  console.warn(
    `[oshi-live-alert] ${what}:`,
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
    const sites = ADAPTERS.filter((a) => adapterOn(settings, a)).map(
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
 * gap, fetch the page again from inside the tab. That is the server's HTML,
 * which the parsers expect: the rendered page may have been rewritten by its
 * scripts (LivePocket's translation widget turns it into the browser's
 * language, and the artist no longer matches). The worker itself may not get
 * past the check (its requests may lack the cookie), so the open tab is
 * handed to `keep`, which must close it, to fetch the posters too.
 *
 * @param {string} url
 * @param {RegExp | undefined} expect marker of a genuine results page
 * @param {(tabId: number) => void} keep
 * @returns {Promise<Response>}
 */
async function fetchViaTab(url, expect, keep) {
  const looksOk = (/** @type {string} */ html) =>
    Boolean(html) &&
    (expect
      ? expect.test(html)
      : !/awsWafCookieDomainList|AwsWafIntegration|challenge-platform/.test(
          html.slice(0, 20_000)
        ));
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = /** @type {number} */ (tab.id);
  keep(tabId);
  let passed = false;
  for (let i = 0; i < 20 && !passed; i++) {
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
    passed = looksOk(/** @type {string} */ (result?.result ?? ''));
  }
  if (!passed) return new Response('', { status: 503 });
  // The tab's page load was a request to the site too: keep the per-site gap
  // before the refetch.
  await sleep(GAP_MS);
  const again = await fetchInTab(tabId, url).catch(() => null);
  const text = again?.ok ? await again.clone().text() : '';
  return again && looksOk(text) ? again : new Response('', { status: 503 });
}

/**
 * Fetch a URL from inside a tab's page (same origin, its cookies), for a
 * site whose bot check the worker cannot pass.
 *
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchInTab(tabId, url) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [url],
    func: async (/** @type {string} */ u) => {
      const r = await fetch(u, { credentials: 'include' });
      const bytes = new Uint8Array(await r.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        status: r.status,
        type: r.headers.get('content-type') ?? '',
        data: btoa(binary),
      };
    },
  });
  const r =
    /** @type {{ status: number, type: string, data: string } | undefined} */ (
      injection?.result
    );
  if (!r) throw new Error('no result from the tab');
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    status: r.status,
    headers: { 'content-type': r.type },
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
 * @param {number} [tabId] fetch from inside this tab (see fetchViaTab)
 */
async function storePosters(listings, tabId) {
  const { inbox } = await store.read();
  const have = new Set(await chrome.storage.local.getKeys());
  await cacheThumbs(thumbsToFetch(inbox, listings, have), {
    fetch: (url, init) =>
      tabId === undefined ? fetch(url, init) : fetchInTab(tabId, url),
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
  /** @type {number | undefined} */
  let tabId;
  try {
    await runJobOnce(job, baseline, baselines, (id) => (tabId = id));
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

/**
 * @param {import('./lib/schedule.js').Job} job
 * @param {boolean} baseline
 * @param {Map<string, number>} baselines
 * @param {(tabId: number) => void} keepTab a background tab to close later
 */
async function runJobOnce(job, baseline, baselines, keepTab) {
  const adapter = adapterById(job.site);
  if (!adapter) return;
  /** @type {number | undefined} */
  let posterTab;
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
    result = await attempt((url) =>
      fetchViaTab(url, adapter.expect, (id) => {
        posterTab = id;
        keepTab(id);
      })
    );
  }
  if (result.outcome.kind === 'ok' && adapter.posterFromPage) {
    // Best effort, like the stored posters below: the listings go in either way.
    const { inbox } = await store.read();
    const { listings } = result;
    result = {
      ...result,
      listings: await findPosters({
        adapter,
        inbox,
        listings,
        fetch: fetchFn,
        sleep,
        gapMs: GAP_MS,
      }).catch((e) => {
        warn('finding posters failed', e);
        return listings;
      }),
    };
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
    await storePosters(result.listings, posterTab).catch((e) =>
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
      title: t('notifyNewLives', fresh.length),
      message: '',
      items: fresh
        .slice(0, 5)
        .map((c) => ({ title: c.keywords.join(', '), message: c.title })),
      priority: 1,
    });
  } else {
    for (const c of fresh) await notifyConcert(c, null);
  }
  for (const c of changed) await notifyConcert(c, noteText(c.update));
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
      ? t('notifyUpdate', update, c.keywords.join(', '))
      : t('notifyNewLive', c.keywords.join(', ')),
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
    title: t('notifyWatching'),
    message: found
      .map(([k, n]) => plural('notifyWatchingCount', n, k, n))
      .join('\n'),
    contextMessage: t('notifyWatchingNote'),
    priority: 0,
  });
}

/**
 * Reconcile all due reminders whenever Chrome can deliver one. Run under the
 * same lock as inbox and settings edits so concurrent wake-ups share a receipt.
 */
function refreshTicketReminders() {
  return store
    .serial(async () => {
      const { settings, inbox } = await store.read();
      let nextAlarm = Infinity;
      let active;

      if (settings.notify && settings.ticketReminderHours > 0) {
        const repeat = settings.ticketReminderHours * HOUR_MS;
        for (const concert of Object.values(inbox.concerts)) {
          const ticket = concert.ticket;
          if (!ticket?.date || !ticket.time) continue;
          const start = ticketStart(ticket);
          if (start === null || !Number.isFinite(start)) continue;
          const pending = ticket.pendingReminderAt;
          const due =
            pending ??
            Math.max(
              start - TICKET_LEAD_MS,
              (ticket.lastReminderAt ?? -Infinity) + repeat
            );
          if (due >= start || Date.now() >= start) continue;
          if (due > Date.now()) {
            nextAlarm = Math.min(nextAlarm, due);
            continue;
          }

          active ??= (await chrome.idle.queryState(60)) === 'active';
          const now = Date.now();
          if (!active || now >= start) continue;
          // A pending attempt has a stable notification ID. On restart, a
          // visible notification can be acknowledged without displaying it again.
          const attemptAt = pending ?? now;
          const notificationId = `ticket:${concert.id}:${attemptAt}`;
          let persisted = ticket;
          let next = now + 60_000;
          try {
            if (pending === undefined) {
              concert.ticket = { ...ticket, pendingReminderAt: attemptAt };
              await chrome.storage.local.set({ inbox });
              persisted = concert.ticket;
            }
            const displayed =
              pending !== undefined &&
              Object.hasOwn(
                await chrome.notifications.getAll(),
                notificationId
              );
            let lastReminderAt = attemptAt;
            if (!displayed) {
              if (Date.now() >= start) continue;
              await chrome.notifications.create(notificationId, {
                type: 'basic',
                iconUrl: ICON,
                title: t('ticketReminderTitle'),
                message: t(
                  'ticketReminderMessage',
                  concert.title,
                  formatDates([ticket.date], ticket.time)
                ),
                contextMessage: concert.venue ?? undefined,
                priority: 1,
              });
              lastReminderAt = Date.now();
            }
            concert.ticket = {
              date: ticket.date,
              time: ticket.time,
              lastReminderAt,
            };
            await chrome.storage.local.set({ inbox });
            next = lastReminderAt + repeat;
          } catch (error) {
            warn('ticket reminder failed', error);
            concert.ticket = persisted;
          }
          if (next < start) nextAlarm = Math.min(nextAlarm, next);
        }
      }

      if (Number.isFinite(nextAlarm))
        await chrome.alarms.create(TICKET_ALARM, { when: nextAlarm });
      else await chrome.alarms.clear(TICKET_ALARM);
    })
    .catch((error) => warn('scheduling ticket reminders failed', error));
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
  if (kind === 'c' || kind === 'ticket') {
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
  setTicket: async ({ id, ticket }) => {
    await store.update('inbox', (inbox) => ({
      value: setTicket(inbox, id, ticket),
    }));
    await refreshTicketReminders();
  },
  delete: async ({ ids }) => {
    await store.update('inbox', (inbox) => ({ value: remove(inbox, ids) }));
    await refreshTicketReminders();
  },
  clearRead: async ({ ids }) =>
    store.update('inbox', (inbox) => {
      const confirmed = Array.isArray(ids) ? new Set(ids) : null;
      const eligible = clearableIds(inbox).filter(
        (id) => !confirmed || confirmed.has(id)
      );
      return { value: remove(inbox, eligible), result: eligible.length };
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
    if (
      next.notify !== before.notify ||
      next.ticketReminderHours !== before.ticketReminderHours
    )
      await refreshTicketReminders();
    await ensureAlarm();
    const added = next.keywords.filter((k) => !before.keywords.includes(k));
    const sitesOn = ADAPTERS.some(
      (a) => adapterOn(next, a) && !adapterOn(before, a)
    );
    if (sitesOn) await startRound();
    else if (added.length > 0) await startRound(added);
    else
      await store.update('schedule', (s) => ({
        value: retain(s, {
          keywords: next.keywords,
          sites: ADAPTERS.filter((a) => adapterOn(next, a)).map((a) => a.id),
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
  if (alarm.name === TICKET_ALARM) void refreshTicketReminders();
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'active') void refreshTicketReminders();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  void refreshTicketReminders();
  await ensureAlarm();
  await updateBadge();
  if (reason === 'install') await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  void refreshTicketReminders();
  await ensureAlarm();
  await updateBadge();
  void pump();
});
