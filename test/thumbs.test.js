import { vi } from 'vitest';
import { emptyInbox, ingest } from '../extension/src/lib/inbox.js';
import {
  MAX_PER_JOB,
  cacheThumbs,
  staleThumbs,
  thumbKey,
  thumbsToFetch,
  toDataUrl,
} from '../extension/src/lib/thumbs.js';

let day = 0;
/**
 * A listing on its own date, so ingest never merges two of them into one show.
 *
 * @param {string} siteId @param {string | null} image
 */
const listing = (siteId, image) => ({
  site: 'livepocket',
  siteId,
  url: `https://livepocket.jp/e/${siteId}`,
  title: `ヨルシカ LIVE ${siteId}`,
  performers: [],
  venue: null,
  prefecture: null,
  dates: [new Date(Date.UTC(2099, 0, 1 + day++)).toISOString().slice(0, 10)],
  time: null,
  saleLabel: null,
  saleStart: null,
  saleEnd: null,
  image,
});

/** @param {ReturnType<typeof listing>[]} listings */
const inboxOf = (listings) =>
  ingest(emptyInbox(), {
    keyword: 'ヨルシカ',
    listings,
    now: '2026-11-18T00:00:00.000Z',
    baseline: true,
  }).state;

const img = (/** @type {string} */ n) => `https://livepocket.jp/img/${n}.webp`;

describe('thumbs', () => {
  test('thumbKey is stable per URL and prefixed', () => {
    expect(thumbKey(img('a'))).toBe(thumbKey(img('a')));
    expect(thumbKey(img('a'))).not.toBe(thumbKey(img('b')));
    expect(thumbKey(img('a'))).toMatch(/^thumb:/);
  });

  test('thumbsToFetch picks shown images without a stored copy, up to a cap', () => {
    const listings = [
      listing('1', img('a')),
      listing('2', null),
      listing('3', img('b')),
      listing('4', img('c')),
    ];
    const inbox = inboxOf(listings);
    expect(thumbsToFetch(inbox, listings, new Set())).toEqual([
      img('a'),
      img('b'),
      img('c'),
    ]);
    // Already stored, and the cap.
    expect(
      thumbsToFetch(inbox, listings, new Set([thumbKey(img('b'))]), 1)
    ).toEqual([img('a')]);
    // A listing the inbox does not know, or one whose concert shows another
    // offer's image, is skipped; a URL is fetched once.
    expect(
      thumbsToFetch(
        inbox,
        [listing('9', img('z')), { ...listing('1', img('other')) }],
        new Set()
      )
    ).toEqual([]);
    const twice = [listing('1', img('a')), listing('1', img('a'))];
    expect(thumbsToFetch(inbox, twice, new Set())).toEqual([img('a')]);
    expect(MAX_PER_JOB).toBe(5);
    const many = Array.from({ length: 8 }, (_, i) =>
      listing(`m${i}`, img(`m${i}`))
    );
    expect(thumbsToFetch(inboxOf(many), many, new Set())).toHaveLength(5);
  });

  test('staleThumbs lists stored copies no concert shows', () => {
    const inbox = inboxOf([listing('1', img('a')), listing('2', null)]);
    expect(
      staleThumbs(
        ['settings', 'inbox', thumbKey(img('a')), thumbKey(img('gone'))],
        inbox
      )
    ).toEqual([thumbKey(img('gone'))]);
  });

  test('toDataUrl encodes bytes as base64', () => {
    expect(toDataUrl(new Uint8Array([104, 105]), 'image/webp')).toBe(
      'data:image/webp;base64,aGk='
    );
    // Larger than one chunk.
    const big = new Uint8Array(70_000).fill(65);
    expect(atob(toDataUrl(big, 'image/png').split(',')[1])).toHaveLength(
      70_000
    );
  });

  test('cacheThumbs keeps the gap, stores good images, skips failures', async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {Record<string, string>} */
    const saved = {};
    const image = () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      });
    /** @type {Record<string, () => Response>} */
    const responses = {
      [img('ok')]: image,
      [img('challenge')]: () =>
        new Response(null, {
          status: 202,
          headers: { 'x-amzn-waf-action': 'challenge' },
        }),
      [img('html')]: () =>
        new Response('<html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      [img('bad')]: image,
      [img('ok2')]: image,
    };
    const fetch = vi.fn(async (/** @type {string} */ url, init) => {
      events.push(`fetch ${url.slice(-8)}`);
      expect(init).toMatchObject({ credentials: 'include' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      if (url === img('down')) throw new Error('network');
      return responses[url]();
    });
    const count = await cacheThumbs(
      [
        img('ok'),
        img('challenge'),
        img('html'),
        img('down'),
        img('bad'),
        img('ok2'),
      ],
      {
        fetch,
        shrink: async (blob) => {
          if (fetch.mock.calls.at(-1)?.[0] === img('bad'))
            throw new Error('decode');
          return `data:${blob.type};n=${blob.size}`;
        },
        save: async (items) => {
          Object.assign(saved, items);
        },
        sleep: async (ms) => {
          events.push(`sleep ${ms}`);
        },
        gapMs: 3_000,
      }
    );
    expect(count).toBe(2);
    expect(saved).toEqual({
      [thumbKey(img('ok'))]: 'data:image/webp;n=3',
      [thumbKey(img('ok2'))]: 'data:image/webp;n=3',
    });
    // Every request waits the per-site gap first (the job's own request
    // came just before).
    expect(events.filter((e) => e.startsWith('sleep'))).toHaveLength(6);
    expect(events[0]).toBe('sleep 3000');
    expect(
      await cacheThumbs([], { fetch, shrink: vi.fn(), save: vi.fn() })
    ).toBe(0);
  });

  test('cacheThumbs waits with a real timer by default and needs a content type', async () => {
    const save = vi.fn();
    expect(
      await cacheThumbs([img('typeless')], {
        fetch: async () => new Response(new Uint8Array([1]), { status: 200 }),
        shrink: async () => 'data:',
        save,
        gapMs: 1,
      })
    ).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});
