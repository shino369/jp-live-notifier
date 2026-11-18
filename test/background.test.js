// @vitest-environment jsdom
/**
 * The real service worker's polling pump, run with fake timers against a fake
 * `chrome` (the real offscreen parser answers parse requests) and a fake
 * `fetch`, to check request spacing and that one failure does not strand the
 * rest of the queue.
 */
import { vi } from 'vitest';
import {
  emptySchedule,
  GAP_MS,
  syncKey,
} from '../extension/src/lib/schedule.js';
import { defaultSettings } from '../extension/src/lib/settings.js';
import { thumbKey } from '../extension/src/lib/thumbs.js';
import { Blob as NodeBlob } from 'buffer';
import fs from 'fs';
import path from 'path';
import { ADAPTERS } from '../extension/src/sites/index.js';
import { fakeChrome } from './fake-chrome.js';

/** An e+ search page listing these titles. @param {string[]} titles */
const eplusPage = (titles) =>
  `<html><body><script id="json" type="application/json">${JSON.stringify({
    data: {
      record_list: titles.map((t, i) => ({
        koen_detail_url_pc: `/sf/detail/${i}`,
        kanren_kogyo_sub: { kogyo_name_1: t },
        koenbi_term: '20991205',
        kanren_uketsuke_koen_list: [],
      })),
    },
  })}</script></body></html>`;

/** @param {string} body @param {number} [status] */
const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

/**
 * Start the worker with only one site on (e+ by default) and these keywords
 * queued.
 *
 * @param {{
 *   keywords: string[],
 *   fetch: (url: string) => Promise<Response>,
 *   synced?: boolean,
 *   tabFallback?: boolean,
 *   site?: string,
 * }} options
 */
async function startWorker({
  keywords,
  fetch,
  synced = true,
  tabFallback,
  site = 'eplus',
}) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetch));
  const fake = fakeChrome({
    data: {
      settings: {
        ...defaultSettings(),
        keywords,
        sites: Object.fromEntries(ADAPTERS.map((a) => [a.id, a.id === site])),
        tabFallback: Boolean(tabFallback),
      },
      schedule: {
        ...emptySchedule(),
        queue: keywords.map((keyword) => ({ keyword, site })),
        synced: synced
          ? Object.fromEntries(keywords.map((k) => [syncKey(k, site), 1]))
          : {},
      },
    },
  });
  /** @type {Array<(alarm: { name: string }) => void>} */
  const onAlarm = [];
  /** @type {Array<{ name: string, info: any }>} */
  const alarms = [];
  /** @type {any} */
  const chrome = fake.chrome;
  chrome.alarms = {
    get: async () => undefined,
    create: async (/** @type {string} */ name, /** @type {any} */ info) => {
      alarms.push({ name, info });
    },
    onAlarm: { addListener: (/** @type {any} */ fn) => onAlarm.push(fn) },
  };
  chrome.offscreen = { createDocument: async () => undefined };
  /** @type {any} */ (globalThis).chrome = chrome;
  await import('../extension/src/background.js');
  await import('../extension/src/offscreen.js');
  const pump = async (ms = 60_000) => {
    for (const fn of onAlarm) fn({ name: 'pump' });
    await vi.advanceTimersByTimeAsync(ms);
  };
  return { ...fake, chrome, alarms, pump };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-17T03:00:00Z') });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tab fallback', () => {
  test('waits the per-site gap between the tab load and the refetch', async () => {
    /** @type {Array<{ what: string, at: number }>} */
    const events = [];
    let calls = 0;
    const page = eplusPage(['ヨルシカ LIVE']);
    const worker = await startWorker({
      keywords: ['ヨルシカ'],
      tabFallback: true,
      fetch: async () => {
        events.push({ what: 'fetch', at: Date.now() });
        return calls++ === 0 ? html('', 403) : html(page);
      },
    });
    worker.chrome.tabs.create = async () => {
      events.push({ what: 'tab', at: Date.now() });
      return { id: 7 };
    };
    worker.chrome.scripting = {
      executeScript: async () => [{ result: page }],
    };

    await worker.pump();

    expect(events.map((e) => e.what)).toEqual(['fetch', 'tab', 'fetch']);
    const [blocked, tab, refetch] = events.map((e) => e.at);
    expect(tab - blocked).toBeGreaterThanOrEqual(GAP_MS);
    expect(refetch - tab).toBeGreaterThanOrEqual(GAP_MS);
    expect(Object.keys(worker.stored.inbox.concerts)).toHaveLength(1);
  });
});

describe('posters', () => {
  test('stores bot-checked posters after a job and drops them with their concert', async () => {
    const page = fs.readFileSync(
      path.resolve(import.meta.dirname, 'fixtures/livepocket-yorushika.html'),
      'utf-8'
    );
    /** @type {string[]} */
    const imageRequests = [];
    const worker = await startWorker({
      keywords: ['ヨルシカ'],
      site: 'livepocket',
      fetch: async (url) => {
        if (url.includes('/event/search')) return html(page);
        imageRequests.push(url);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        });
      },
    });
    // Service-worker image APIs, faked: a 2400 × 1200 image shrinks to 480 × 240.
    /** @type {Array<[number, number]>} */
    const canvases = [];
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 2400,
      height: 1200,
      close: () => {},
    }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        /** @param {number} w @param {number} h */
        constructor(w, h) {
          canvases.push([w, h]);
        }
        getContext() {
          return { drawImage: () => {} };
        }
        async convertToBlob() {
          // Node's Blob: jsdom's has no arrayBuffer(), Chrome's does.
          return new NodeBlob([new Uint8Array([104, 105])], {
            type: 'image/webp',
          });
        }
      }
    );

    await worker.pump(120_000);

    const concerts = Object.values(worker.stored.inbox.concerts);
    const shown = concerts.filter((c) => c.image);
    expect(shown.length).toBeGreaterThan(0);
    expect(imageRequests.length).toBe(Math.min(5, shown.length));
    const key = thumbKey(/** @type {string} */ (shown[0].image));
    expect(worker.stored[key]).toBe('data:image/webp;base64,aGk=');
    expect(canvases[0]).toEqual([480, 240]);

    // Deleting the concert removes its stored poster.
    const reply = worker.chrome.runtime.sendMessage({
      type: 'delete',
      ids: [shown[0].id],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await reply).toMatchObject({ ok: true });
    expect(worker.stored[key]).toBeUndefined();
  });
});

describe('check now', () => {
  test('retries a site that is cooling down after a block', async () => {
    const page = eplusPage(['ヨルシカ LIVE']);
    const worker = await startWorker({
      keywords: ['ヨルシカ'],
      fetch: async () => html(page),
    });
    const until = Date.now() + 30 * 60_000;
    worker.stored.schedule = {
      ...emptySchedule(),
      queue: [],
      synced: { [syncKey('ヨルシカ', 'eplus')]: 1 },
      sites: {
        eplus: {
          lastRequestAt: 0,
          cooldownUntil: until,
          failures: 1,
          lastOkAt: null,
          lastError: 'AWS WAF challenge',
          lastCount: null,
        },
      },
    };

    const reply = worker.chrome.runtime.sendMessage({ type: 'checkNow' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await reply).toEqual({ ok: true, result: undefined });

    expect(worker.stored.schedule.sites.eplus).toMatchObject({
      cooldownUntil: 0,
      failures: 0,
      lastError: null,
    });
    expect(Object.keys(worker.stored.inbox.concerts)).toHaveLength(1);
  });
});

describe('pump', () => {
  test('keeps working the queue when a notification fails', async () => {
    const worker = await startWorker({
      keywords: ['ヨルシカ', '花譜'],
      fetch: async () => html(eplusPage(['ヨルシカ LIVE', '花譜 LIVE'])),
    });
    worker.chrome.notifications.create = vi.fn(async () => {
      throw new Error('Notifier not enabled');
    });

    await worker.pump();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(worker.chrome.notifications.create).toHaveBeenCalledTimes(2);
    expect(worker.stored.schedule.queue).toEqual([]);
    expect(Object.keys(worker.stored.inbox.concerts)).toHaveLength(2);
  });

  test('reschedules itself when a job fails unexpectedly', async () => {
    const worker = await startWorker({
      keywords: ['ヨルシカ', '花譜'],
      fetch: async () => html(eplusPage(['ヨルシカ LIVE', '花譜 LIVE'])),
    });
    const set = worker.chrome.storage.local.set;
    let failed = false;
    worker.chrome.storage.local.set = async (
      /** @type {Record<string, any>} */ items
    ) => {
      if ('inbox' in items && !failed) {
        failed = true;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      return set(items);
    };

    await worker.pump(10_000);

    expect(worker.stored.schedule.queue).toEqual([
      { keyword: '花譜', site: 'eplus' },
    ]);
    expect(worker.alarms).toContainEqual({
      name: 'pump',
      info: { delayInMinutes: 1 },
    });

    await worker.pump();

    expect(worker.stored.schedule.queue).toEqual([]);
  });

  test('a first sync leaves its concerts unread with one summary notification', async () => {
    const worker = await startWorker({
      keywords: ['ヨルシカ'],
      synced: false,
      fetch: async () => html(eplusPage(['ヨルシカ LIVE', 'ヨルシカ TOUR'])),
    });
    const created = vi.fn(async () => '');
    worker.chrome.notifications.create = created;

    await worker.pump();

    const concerts = Object.values(worker.stored.inbox.concerts);
    expect(concerts).toHaveLength(2);
    expect(concerts.every((c) => !c.read)).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]).toMatchObject([
      expect.stringMatching(/^summary:/),
      { title: 'Now watching' },
    ]);
  });

  test('a failing baseline summary does not escape the pump', async () => {
    const worker = await startWorker({
      keywords: ['ヨルシカ'],
      synced: false,
      fetch: async () => html(eplusPage(['ヨルシカ LIVE'])),
    });
    worker.chrome.notifications.create = vi.fn(async () => {
      throw new Error('Notifier not enabled');
    });

    await worker.pump();

    expect(worker.chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(worker.stored.schedule.queue).toEqual([]);
  });
});
