/**
 * Posters read from a listing's own page, for sites whose search results
 * carry no image (e+, 楽天チケット).
 */
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { emptyInbox, ingest } from '../extension/src/lib/inbox.js';
import {
  findPosters,
  pageImage,
  POSTER_PAGES_PER_JOB,
  POSTER_TRIES,
} from '../extension/src/lib/poster.js';
import { adapterById } from '../extension/src/sites/index.js';

const fixture = (/** @type {string} */ name) =>
  fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', name), 'utf8');

const NOW = '2026-11-19T00:00:00.000Z';

/** @param {Partial<import('../extension/src/lib/inbox.js').Listing>} over */
const listing = (over = {}) => ({
  site: 'eplus',
  siteId: '/sf/detail/0025330001-P0030241P021001',
  url: 'https://eplus.jp/sf/detail/0025330001-P0030241P021001',
  title: 'BUMP OF CHICKEN TOUR 2026',
  performers: [],
  venue: '日本武道館',
  prefecture: '東京都',
  dates: ['2026-12-05'],
  time: null,
  saleLabel: null,
  saleStart: null,
  saleEnd: null,
  image: null,
  ...over,
});

/** @param {string} body @param {number} [status] */
const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const eplus = /** @type {import('../extension/src/lib/job.js').Adapter} */ (
  adapterById('eplus')
);
const rakuten = /** @type {import('../extension/src/lib/job.js').Adapter} */ (
  adapterById('rakuten')
);

describe('pageImage', () => {
  test('reads og:image from the e+ and 楽天チケット detail pages', () => {
    expect(
      pageImage(
        fixture('eplus-detail-0025330001.html'),
        'https://eplus.jp/sf/detail/0025330001-P0030241P021001'
      )
    ).toBe('https://eplus.jp/s/image/002533/0001/000/0025330001_16.jpg');
    expect(
      pageImage(
        fixture('rakuten-detail-rt4t324.html'),
        'https://ticket.rakuten.co.jp/music/jpop/mjpn-other/rt4t324/'
      )
    ).toBe(
      'https://tsimg.azureedge.net/img/2026/11/1793841579_ISJ_anima4_KV_large.jpg'
    );
  });

  test('takes either attribute order, entities, relative URLs, and og:image:url', () => {
    const base = 'https://eplus.jp/sf/detail/1';
    expect(
      pageImage(
        `<meta content='/s/image/a.jpg?w=1&amp;h=2' property='og:image'>`,
        base
      )
    ).toBe('https://eplus.jp/s/image/a.jpg?w=1&h=2');
    expect(
      pageImage(
        '<META NAME="og:image:url" CONTENT="https://x.test/p.png">',
        base
      )
    ).toBe('https://x.test/p.png');
  });

  test('null without a usable image: none, not https, ignored, or unparsable', () => {
    const base = 'https://eplus.jp/sf/detail/1';
    expect(pageImage('<meta property="og:title" content="x">', base)).toBe(
      null
    );
    expect(pageImage('<meta property="og:image">', base)).toBe(null);
    expect(
      pageImage(
        '<meta property="og:image" content="http://x.test/a.jpg">',
        base
      )
    ).toBe(null);
    expect(
      pageImage('<meta property="og:image" content="https://[bad">', base)
    ).toBe(null);
    expect(
      pageImage(
        '<meta property="og:image" content="https://eplus.jp/s/eplus/img/webclip.png">',
        base,
        /\/s\/eplus\/img\//
      )
    ).toBe(null);
  });

  test('e+ and 楽天チケット skip their site-wide fallback images', () => {
    const ignore = (/** @type {any} */ a, /** @type {string} */ url) =>
      pageImage(
        `<meta property="og:image" content="${url}">`,
        a.home,
        a.posterFromPage.ignore
      );
    expect(ignore(eplus, 'https://eplus.jp/s/eplus/img/webclip.png')).toBe(
      null
    );
    expect(
      ignore(rakuten, 'https://tsimg.azureedge.net/img/Rakuten-tickets.png')
    ).toBe(null);
    expect(
      ignore(rakuten, 'https://tsimg.azureedge.net/img/2026/11/kv.jpg')
    ).toBe('https://tsimg.azureedge.net/img/2026/11/kv.jpg');
  });
});

describe('findPosters', () => {
  const page = (/** @type {string} */ image) =>
    html(`<html><head><meta property="og:image" content="${image}"></head>`);

  test('fetches the page of each new listing without an image, one gap apart', async () => {
    const fetch = vi.fn(async (/** @type {string} */ url) =>
      url.endsWith('/1') ? page('https://eplus.jp/s/image/1.jpg') : page('')
    );
    const sleep = vi.fn(async () => {});
    const out = await findPosters({
      adapter: eplus,
      inbox: emptyInbox(),
      listings: [
        listing({ siteId: '1', url: 'https://eplus.jp/sf/detail/1' }),
        listing({ siteId: '2', url: 'https://eplus.jp/sf/detail/2' }),
        listing({ siteId: '3', image: 'https://eplus.jp/s/image/3.jpg' }),
      ],
      fetch,
      sleep,
      gapMs: 3_000,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://eplus.jp/sf/detail/1',
      'https://eplus.jp/sf/detail/2',
    ]);
    expect(sleep.mock.calls).toEqual([[3_000], [3_000]]);
    expect(out.map((l) => [l.siteId, l.image, l.posterChecked])).toEqual([
      ['1', 'https://eplus.jp/s/image/1.jpg', true],
      // Checked and nothing found: not asked again.
      ['2', null, true],
      ['3', 'https://eplus.jp/s/image/3.jpg', undefined],
    ]);
  });

  test('skips known listings that are checked, shown with a poster, or deleted', async () => {
    let inbox = ingest(emptyInbox(), {
      keyword: 'BUMP',
      listings: [
        listing({ siteId: 'checked', posterChecked: true }),
        listing({
          siteId: 'shown',
          title: 'Other show',
          venue: '大阪城ホール',
          dates: ['2027-01-10'],
          image: 'https://eplus.jp/s/image/x.jpg',
        }),
        listing({
          siteId: 'old',
          title: 'Old show',
          venue: 'Zepp',
          dates: ['2027-02-01'],
        }),
      ],
      now: NOW,
    }).state;
    // A seen listing whose concert is gone (deleted or pruned) is not shown.
    inbox = {
      ...inbox,
      seen: {
        ...inbox.seen,
        'eplus:gone': { concertId: 'nope', lastSeenAt: NOW },
      },
    };
    const fetch = vi.fn(async (/** @type {string} */ url) =>
      page(`https://eplus.jp/s/image/${url.split('/').pop()}.jpg`)
    );
    const out = await findPosters({
      adapter: eplus,
      inbox,
      listings: ['checked', 'shown', 'gone', 'old'].map((siteId) =>
        listing({ siteId, url: `https://eplus.jp/sf/detail/${siteId}` })
      ),
      fetch,
      sleep: async () => {},
      gapMs: 0,
    });
    // Only the known offer that was never checked (from before this feature).
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://eplus.jp/sf/detail/old',
    ]);
    expect(out.find((l) => l.siteId === 'old')?.image).toBe(
      'https://eplus.jp/s/image/old.jpg'
    );
  });

  test(`asks for at most ${POSTER_PAGES_PER_JOB} pages per job; failures are retried later`, async () => {
    const fetch = vi.fn(async (/** @type {string} */ url) => {
      if (url.endsWith('/0')) throw new Error('reset');
      if (url.endsWith('/1')) return html('', 503);
      return page('https://eplus.jp/s/image/ok.jpg');
    });
    const listings = Array.from({ length: POSTER_PAGES_PER_JOB + 2 }, (_, i) =>
      listing({ siteId: String(i), url: `https://eplus.jp/sf/detail/${i}` })
    );
    const out = await findPosters({
      adapter: eplus,
      inbox: emptyInbox(),
      listings,
      fetch,
      sleep: async () => {},
      gapMs: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(POSTER_PAGES_PER_JOB);
    expect(out.map((l) => l.posterChecked ?? false)).toEqual([
      false,
      false,
      ...Array(POSTER_PAGES_PER_JOB - 2).fill(true),
      false,
      false,
    ]);
  });

  test('a page that is gone (404, 410) is checked at once, not asked again', async () => {
    const fetch = vi.fn(async (/** @type {string} */ url) =>
      html('', url.endsWith('/gone') ? 410 : 404)
    );
    const out = await findPosters({
      adapter: eplus,
      inbox: emptyInbox(),
      listings: ['missing', 'gone'].map((siteId) =>
        listing({ siteId, url: `https://eplus.jp/sf/detail/${siteId}` })
      ),
      fetch,
      sleep: async () => {},
      gapMs: 0,
    });
    expect(out.map((l) => [l.image, l.posterChecked])).toEqual([
      [null, true],
      [null, true],
    ]);
  });

  test('failing pages count their tries, go last, and stop after the last try', async () => {
    // Search order: four pages that always refuse (bot check), then two
    // healthy ones beyond the per-job limit.
    const ids = ['f1', 'f2', 'f3', 'f4', 'ok1', 'ok2'];
    const fetch = vi.fn(async (/** @type {string} */ url) =>
      url.includes('/ok')
        ? page(`https://eplus.jp/s/image/${url.split('/').pop()}.jpg`)
        : html('', 403)
    );
    const search = () =>
      ids.map((siteId, i) =>
        listing({
          siteId,
          title: `公演 ${siteId}`,
          venue: `会場 ${i}`,
          dates: [`2099-01-0${i + 1}`],
          url: `https://eplus.jp/sf/detail/${siteId}`,
        })
      );
    let inbox = emptyInbox();
    /** One polling job: find posters, then ingest, as the worker does. */
    const job = async () => {
      fetch.mockClear();
      const listings = await findPosters({
        adapter: eplus,
        inbox,
        listings: search(),
        fetch,
        sleep: async () => {},
        gapMs: 0,
      });
      inbox = ingest(inbox, { keyword: '公演', listings, now: NOW }).state;
      return fetch.mock.calls.map(([url]) => url.split('/').pop());
    };
    const offer = (/** @type {string} */ siteId) =>
      Object.values(inbox.concerts)
        .flatMap((c) => c.offers)
        .find((o) => o.siteId === siteId);

    expect(await job()).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(offer('f1')).toMatchObject({ posterTries: 1 });
    expect(offer('f1')?.posterChecked).toBeFalsy();
    // The untried ones go first now; the failing ones fill the rest.
    expect(await job()).toEqual(['ok1', 'ok2', 'f1', 'f2']);
    expect(offer('ok1')).toMatchObject({
      image: 'https://eplus.jp/s/image/ok1.jpg',
      posterChecked: true,
    });
    // Each failing page gets POSTER_TRIES tries in all, then is left alone.
    for (let i = 0; i < 10; i++) await job();
    for (const id of ['f1', 'f2', 'f3', 'f4'])
      expect(offer(id), id).toMatchObject({
        posterTries: POSTER_TRIES,
        posterChecked: true,
        image: null,
      });
    expect(await job()).toEqual([]);
  });

  test('does nothing for sites without posterFromPage', async () => {
    const fetch = vi.fn();
    const listings = [listing({ site: 'pia' })];
    const pia = /** @type {any} */ (adapterById('pia'));
    expect(
      await findPosters({
        adapter: pia,
        inbox: emptyInbox(),
        listings,
        fetch,
        sleep: async () => {},
        gapMs: 0,
      })
    ).toBe(listings);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('ingest keeps posters found earlier', () => {
  test('a later search result without an image does not clear it', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'BUMP',
      listings: [
        listing({
          image: 'https://eplus.jp/s/image/1.jpg',
          posterChecked: true,
        }),
      ],
      now: NOW,
    });
    const again = ingest(first.state, {
      keyword: 'BUMP',
      listings: [listing()],
      now: '2026-11-19T01:00:00.000Z',
    });
    const [c] = Object.values(again.state.concerts);
    expect(c.image).toBe('https://eplus.jp/s/image/1.jpg');
    expect(c.offers[0]).toMatchObject({
      image: 'https://eplus.jp/s/image/1.jpg',
      posterChecked: true,
    });
  });
});
