/**
 * Posters for sites whose search results carry no image (e+, 楽天チケット):
 * read from the listing's own page (its `og:image`), once per listing.
 * An offer remembers the check (`posterChecked`), so an event without a
 * poster is not asked for again on every polling job.
 */
import { listingKey } from './inbox.js';
import { TIMEOUT_MS } from './job.js';

/**
 * Pages asked per job, after the search itself: a new artist's first sync
 * can bring a full page of listings, and the rest follow on later jobs.
 */
export const POSTER_PAGES_PER_JOB = 4;

const META = /<meta\b[^>]*>/gi;
const IS_OG_IMAGE = /\b(?:property|name)\s*=\s*["']og:image(?::url)?["']/i;
const CONTENT = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * The page's `og:image` as an absolute https URL, or null (none, not https —
 * extension pages only load https images — or a site-wide fallback image
 * matching `ignore`).
 *
 * @param {string} html
 * @param {string} pageUrl
 * @param {RegExp} [ignore]
 * @returns {string | null}
 */
export function pageImage(html, pageUrl, ignore) {
  for (const [tag] of html.matchAll(META)) {
    if (!IS_OG_IMAGE.test(tag)) continue;
    const m = CONTENT.exec(tag);
    const raw = (m?.[1] ?? m?.[2] ?? '').trim().replaceAll('&amp;', '&');
    if (!raw) return null;
    /** @type {URL} */
    let url;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || ignore?.test(url.href)) return null;
    return url.href;
  }
  return null;
}

/**
 * Whether a listing's poster is still worth looking for: it has no image, the
 * concert it belongs to (if known) shows none yet, and its offer was never
 * checked. A seen listing whose concert is gone (deleted, pruned) is not
 * shown anywhere.
 *
 * @param {import('./inbox.js').InboxState} inbox
 * @param {import('./inbox.js').Listing} l
 */
function wanted(inbox, l) {
  if (l.image) return false;
  const key = listingKey(l);
  const known = inbox.seen[key];
  if (!known) return true;
  const c = inbox.concerts[known.concertId];
  if (!c || c.image) return false;
  return !c.offers.find((o) => listingKey(o) === key)?.posterChecked;
}

/**
 * The job's listings, with posters read from the pages of those that need
 * one (at most `limit`, each `gapMs` after the previous response). A listing
 * whose page answered is marked `posterChecked`, poster or not; one whose
 * page failed is left as is and tried again on a later job.
 *
 * @param {{
 *   adapter: import('./job.js').Adapter,
 *   inbox: import('./inbox.js').InboxState,
 *   listings: import('./inbox.js').Listing[],
 *   fetch: import('./job.js').FetchFn,
 *   sleep: (ms: number) => Promise<unknown>,
 *   gapMs: number,
 *   limit?: number,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<import('./inbox.js').Listing[]>}
 */
export async function findPosters({
  adapter,
  inbox,
  listings,
  fetch,
  sleep,
  gapMs,
  limit = POSTER_PAGES_PER_JOB,
  timeoutMs = TIMEOUT_MS,
}) {
  const options = adapter.posterFromPage;
  if (!options) return listings;
  const todo = listings.filter((l) => wanted(inbox, l)).slice(0, limit);
  /** @type {Map<import('./inbox.js').Listing, string | null>} */
  const found = new Map();
  for (const l of todo) {
    await sleep(gapMs);
    try {
      const response = await fetch(l.url, {
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      found.set(l, pageImage(await response.text(), l.url, options.ignore));
    } catch {
      // Network error or timeout: try again on a later job.
    }
  }
  return listings.map((l) =>
    found.has(l)
      ? { ...l, image: found.get(l) ?? null, posterChecked: true }
      : l
  );
}
