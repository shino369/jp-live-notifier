// @vitest-environment jsdom
import { vi } from 'vitest';
import {
  blockReason,
  decode,
  inertHandlers,
  sniffCharset,
} from '../extension/src/lib/http.js';
import { localParse, runJob } from '../extension/src/lib/job.js';
import {
  GAP_MS,
  emptySchedule,
  enqueueRound,
  finishJob,
  pickJob,
  startJob,
} from '../extension/src/lib/schedule.js';
import { createStore } from '../extension/src/lib/store.js';
import { ago, formatDate, formatDates } from '../extension/src/ui/format.js';

const NOW = new Date(2026, 10, 17, 12);

/** @param {Partial<import('../extension/src/lib/inbox.js').Listing>} over */
const item = (over) => ({
  site: 't',
  siteId: '1',
  url: 'https://x/1',
  title: 'ヨルシカ LIVE',
  performers: [],
  venue: null,
  prefecture: null,
  dates: ['2026-12-01'],
  time: null,
  saleLabel: null,
  saleStart: null,
  saleEnd: null,
  image: null,
  ...over,
});

/** @param {Partial<import('../extension/src/lib/job.js').Adapter>} over */
const adapter = (over = {}) =>
  /** @type {import('../extension/src/lib/job.js').Adapter} */ ({
    id: 't',
    name: 'T',
    home: 'https://x/',
    format: 'json',
    searchUrl: () => 'https://x/s',
    requests: () => [{ url: 'https://x/api' }],
    parse: (json) => json.items,
    ...over,
  });

/** @param {unknown} body @param {ResponseInit} [init] */
const reply = (body, init) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), init);

describe('http', () => {
  test('sniffCharset prefers the header, then meta, then UTF-8', () => {
    const meta = new TextEncoder().encode('<html><meta charset="Shift_JIS">');
    expect(sniffCharset(meta, 'text/html; charset=EUC-JP')).toBe('euc-jp');
    expect(sniffCharset(meta, 'text/html')).toBe('shift_jis');
    expect(sniffCharset(new Uint8Array(), null)).toBe('utf-8');
  });

  test('decode reads Shift_JIS and falls back on unknown labels', () => {
    const sjis = new Uint8Array([
      0x83, 0x88, 0x83, 0x8b, 0x83, 0x56, 0x83, 0x4a,
    ]);
    expect(decode(sjis, 'text/html; charset=Shift_JIS')).toBe('ヨルシカ');
    expect(
      decode(
        new TextEncoder().encode('ok').buffer,
        'text/html; charset=bogus-x'
      )
    ).toBe('ok');
  });

  test('blockReason spots status codes, WAF headers, and challenge pages', () => {
    expect(blockReason(429, '')).toBe('HTTP 429');
    expect(
      blockReason(202, 'x', (n) =>
        n === 'x-amzn-waf-action' ? 'challenge' : null
      )
    ).toBe('AWS WAF challenge');
    expect(blockReason(202, 'tiny')).toBe('HTTP 202 (challenge)');
    expect(blockReason(200, '<title>Just a moment...</title>')).toMatch(
      /^challenge page/
    );
    expect(blockReason(200, '<html>fine</html>')).toBeNull();
  });
});

describe('inertHandlers', () => {
  test('renames inline event handler attributes so parsing runs no CSP check', () => {
    expect(
      inertHandlers(
        '<a href="/onsale=1" onclick="go()">x</a><img src=a.png\n  ONERROR = \'f()\'><body onload=init>'
      )
    ).toBe(
      '<a href="/onsale=1" data-onclick="go()">x</a><img src=a.png\n  data-onerror = \'f()\'><body data-onload=init>'
    );
    expect(inertHandlers('turn on the radio')).toBe('turn on the radio');
  });

  test('localParse hands the parser HTML without inline handlers', async () => {
    /** @type {string[]} */
    const seen = [];
    const parse = localParse({
      parseFromString: (text) => {
        seen.push(text);
        return new DOMParser().parseFromString(text, 'text/html');
      },
    });
    const adapter = /** @type {any} */ ({
      format: 'html',
      parse: (/** @type {Document} */ doc) => [
        doc.querySelector('a')?.textContent,
      ],
    });
    expect(
      await parse(adapter, '<a onclick="x()">hi</a>', /** @type {any} */ ({}))
    ).toEqual(['hi']);
    expect(seen).toEqual(['<a data-onclick="x()">hi</a>']);
  });
});

describe('runJob', () => {
  test('returns upcoming listings that mention the keyword, deduplicated', async () => {
    const items = [
      item({}),
      item({}),
      item({ siteId: '2', title: 'other' }),
      item({ siteId: '3', dates: ['2026-01-01'] }),
      item({ siteId: '4', title: 'fes', performers: ['よるしか'], dates: [] }),
    ];
    const fetch = vi.fn(reply({ items }));
    const r = await runJob({
      adapter: adapter(),
      keyword: 'ヨルシカ',
      now: NOW,
      fetch,
      parse: localParse(new DOMParser()),
    });
    expect(r.outcome).toEqual({ kind: 'ok', count: 2 });
    expect(r.listings.map((l) => l.siteId)).toEqual(['1', '4']);
    expect(fetch).toHaveBeenCalledWith(
      'https://x/api',
      expect.objectContaining({ credentials: 'include' })
    );
    const all = await runJob({
      adapter: adapter({ filterLocally: false }),
      keyword: 'ヨルシカ',
      now: NOW,
      fetch,
      parse: localParse(new DOMParser()),
    });
    expect(all.outcome).toEqual({ kind: 'ok', count: 3 });
  });

  test('parses HTML pages and walks every request', async () => {
    const html = adapter({
      format: 'html',
      requests: () => [{ url: 'https://x/1' }, { url: 'https://x/2' }],
      parse: (doc, ctx) =>
        [...doc.querySelectorAll('li')].map((li) =>
          item({ siteId: `${ctx.page}-${li.textContent}` })
        ),
    });
    const r = await runJob({
      adapter: html,
      keyword: 'ヨルシカ',
      now: NOW,
      fetch: reply('<ul><li>a</li><li>b</li></ul>', {
        headers: { 'content-type': 'text/html' },
      }),
      parse: localParse(new DOMParser()),
      sleep: async () => {},
    });
    expect(r.listings.map((l) => l.siteId)).toEqual([
      '1-a',
      '1-b',
      '2-a',
      '2-b',
    ]);
  });

  test('waits the per-site gap between the requests of one job', async () => {
    /** @type {string[]} */
    const events = [];
    const sleep = vi.fn(async (/** @type {number} */ ms) => {
      events.push(`sleep ${ms}`);
    });
    const r = await runJob({
      adapter: adapter({
        requests: () => [{ url: 'https://x/1' }, { url: 'https://x/2' }],
      }),
      keyword: 'ヨルシカ',
      now: NOW,
      fetch: async (url) => {
        events.push(`fetch ${url}`);
        return new Response(JSON.stringify({ items: [item({})] }));
      },
      parse: localParse(new DOMParser()),
      sleep,
    });
    expect(r.outcome.kind).toBe('ok');
    expect(events).toEqual([
      'fetch https://x/1',
      `sleep ${GAP_MS}`,
      'fetch https://x/2',
    ]);
  });

  test('the next job on a site waits the gap after the previous job ends', () => {
    const job = { keyword: 'a', site: 'x' };
    let s = enqueueRound(emptySchedule(), {
      keywords: ['a', 'b'],
      sites: ['x'],
      now: 0,
    });
    s = startJob(s, 0, 0);
    // A two-page job: its last request went out well after it started.
    s = finishJob(s, job, { kind: 'ok', count: 0 }, 5_000);
    expect(pickJob(s, 5_000)).toEqual({ waitMs: GAP_MS });
    expect(
      finishJob(s, job, { kind: 'error', error: 'e' }, 6_000).sites.x
        .lastRequestAt
    ).toBe(6_000);
  });

  test('reports blocks, HTTP errors, network errors, and parse errors', async () => {
    const parse = localParse(new DOMParser());
    const base = { adapter: adapter(), keyword: 'k', now: NOW, parse };
    expect(
      (await runJob({ ...base, fetch: reply('', { status: 403 }) })).outcome
    ).toEqual({ kind: 'blocked', error: 'HTTP 403' });
    expect(
      (
        await runJob({
          ...base,
          fetch: reply('<html>' + 'x'.repeat(6000), { status: 500 }),
        })
      ).outcome
    ).toEqual({ kind: 'error', error: 'HTTP 500' });
    expect(
      (
        await runJob({
          ...base,
          fetch: async () => Promise.reject(new Error('offline')),
        })
      ).outcome
    ).toEqual({ kind: 'error', error: 'network: offline' });
    expect(
      (await runJob({ ...base, fetch: async () => Promise.reject('down') }))
        .outcome
    ).toEqual({ kind: 'error', error: 'network: down' });
    expect(
      (await runJob({ ...base, fetch: reply('not json') })).outcome.kind
    ).toBe('error');
    expect(
      (
        await runJob({
          ...base,
          adapter: adapter({ expect: /marker/ }),
          fetch: reply({ items: [] }),
        })
      ).outcome
    ).toEqual({
      kind: 'blocked',
      error: expect.stringMatching(/^not a results page/),
    });
    // Headers arrive, then the body stream fails (timeout or disconnect).
    const brokenBody = async () =>
      /** @type {Response} */ (
        /** @type {unknown} */ ({
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          arrayBuffer: () => Promise.reject(new Error('body stream aborted')),
        })
      );
    expect((await runJob({ ...base, fetch: brokenBody })).outcome).toEqual({
      kind: 'error',
      error: 'network: body stream aborted',
    });
    const hang = (
      /** @type {string} */ _url,
      /** @type {RequestInit} */ init
    ) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason)
        )
      );
    expect(
      (
        await runJob({
          ...base,
          fetch: /** @type {any} */ (hang),
          timeoutMs: 10,
        })
      ).outcome
    ).toEqual({
      kind: 'error',
      error: expect.stringMatching(/^network: .*time/i),
    });
  });
});

describe('store', () => {
  test('reads defaults and serializes updates', async () => {
    /** @type {Record<string, any>} */
    const data = {};
    const area = {
      get: vi.fn(async (/** @type {string[]} */ keys) =>
        Object.fromEntries(
          keys
            .filter((k) => k in data)
            .map((k) => [k, structuredClone(data[k])])
        )
      ),
      set: vi.fn(async (/** @type {Record<string, any>} */ items) => {
        await new Promise((r) => setTimeout(r, 1));
        Object.assign(data, structuredClone(items));
      }),
    };
    const store = createStore(area);
    expect((await store.read()).settings.intervalMinutes).toBe(60);
    const bump = () =>
      store.update('settings', (s) => ({
        value: { ...s, keywords: [...s.keywords, `k${s.keywords.length}`] },
        result: s.keywords.length,
      }));
    const results = await Promise.all([bump(), bump(), bump()]);
    expect(results).toEqual([0, 1, 2]);
    expect(data.settings.keywords).toEqual(['k0', 'k1', 'k2']);
    await expect(
      store.update('inbox', () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await bump()).toBe(3);
  });
});

describe('format', () => {
  test('dates and relative times', () => {
    expect(formatDate('2026-12-05')).toBe('2026/12/05 (Sat)');
    expect(formatDates([])).toBe('Date TBA');
    expect(formatDates(['2026-12-05'], '18:00')).toBe('2026/12/05 (Sat) 18:00');
    expect(formatDates(['2026-12-05'])).toBe('2026/12/05 (Sat)');
    expect(formatDates(['2026-12-05', '2027-01-10'])).toBe(
      '2026/12/05 (Sat) – 2027/01/10 (Sun)'
    );
    expect(formatDates(['2026-12-05', '2026-12-06', '2027-01-10'])).toBe(
      '2026/12/05 (Sat) – 2027/01/10 (Sun) · 3 dates'
    );
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(ago('2026-11-17T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-17T11:30:00Z', now)).toBe('30 min ago');
    expect(ago('2026-11-17T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-11-14T12:00:00Z', now)).toBe('3 d ago');
    expect(ago('2026-10-01T12:00:00Z', now)).toBe('2026/10/01');
  });
});
