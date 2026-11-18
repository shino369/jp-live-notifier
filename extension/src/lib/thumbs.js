/**
 * Stored copies of listing images (posters). A bot-checked site (LivePocket's
 * AWS WAF) also guards its images: the inbox page's <img> gets the empty
 * challenge once the check's pass expires, and the poster disappears. So
 * right after a successful job, while the pass is fresh, the service worker
 * fetches the images, shrinks them, and stores each as a data URL under its
 * own key (`thumb:<hash of the URL>`), outside the inbox record so inbox
 * updates stay small. Copies no concert shows any more are swept.
 */
import { listingKey } from './inbox.js';
import { GAP_MS } from './schedule.js';
import { hash } from './text.js';

export const THUMB_PREFIX = 'thumb:';
/** Images fetched after one job at most; the rest wait for later jobs. */
export const MAX_PER_JOB = 5;
const TIMEOUT_MS = 20_000;

/** @param {string} url */
export const thumbKey = (url) => `${THUMB_PREFIX}${hash(url)}`;

/**
 * Images of these listings that their concert shows and that have no stored
 * copy yet, at most `max`.
 *
 * @param {import('./inbox.js').InboxState} inbox
 * @param {import('./inbox.js').Listing[]} listings
 * @param {Set<string>} have storage keys that exist
 * @param {number} [max]
 * @returns {string[]}
 */
export function thumbsToFetch(inbox, listings, have, max = MAX_PER_JOB) {
  /** @type {string[]} */
  const out = [];
  for (const l of listings) {
    if (out.length >= max) break;
    if (!l.image || out.includes(l.image) || have.has(thumbKey(l.image)))
      continue;
    const id = inbox.seen[listingKey(l)]?.concertId;
    if (id && inbox.concerts[id]?.image === l.image) out.push(l.image);
  }
  return out;
}

/**
 * Stored copies that no concert shows any more.
 *
 * @param {string[]} keys every storage key
 * @param {import('./inbox.js').InboxState} inbox
 * @returns {string[]}
 */
export function staleThumbs(keys, inbox) {
  const shown = new Set(
    Object.values(inbox.concerts)
      .map((c) => c.image)
      .filter((u) => u !== null)
      .map(thumbKey)
  );
  return keys.filter((k) => k.startsWith(THUMB_PREFIX) && !shown.has(k));
}

/**
 * @param {Uint8Array} bytes
 * @param {string} type
 * @returns {string}
 */
export function toDataUrl(bytes, type) {
  let binary = '';
  // In chunks: spreading a large array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/**
 * Fetch, shrink, and store each image, waiting the per-site gap before every
 * request (the job's own request came just before). A failure (challenge,
 * not an image, network, decode) skips that image only; a later job tries it
 * again.
 *
 * @param {string[]} urls
 * @param {{
 *   fetch: (url: string, init: RequestInit) => Promise<Response>,
 *   shrink: (blob: Blob) => Promise<string>,
 *   save: (items: Record<string, string>) => Promise<void>,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   gapMs?: number,
 * }} io
 * @returns {Promise<number>} how many were stored
 */
export async function cacheThumbs(
  urls,
  {
    fetch,
    shrink,
    save,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    gapMs = GAP_MS,
  }
) {
  let stored = 0;
  for (const url of urls) {
    await sleep(gapMs);
    try {
      const response = await fetch(url, {
        credentials: 'include',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = response.headers.get('content-type') ?? '';
      // A WAF challenge answers 202 with an empty body.
      if (response.status !== 200 || !type.startsWith('image/')) continue;
      await save({ [thumbKey(url)]: await shrink(await response.blob()) });
      stored++;
    } catch {
      // Skipped; retried after a later job.
    }
  }
  return stored;
}
