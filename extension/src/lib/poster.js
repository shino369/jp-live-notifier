/**
 * Posters for sites whose search results carry no image (e+, 楽天チケット):
 * read from the listing's own page (its `og:image`), once per listing.
 * An offer remembers the check (`posterChecked`), so an event without a
 * poster is not asked for again on every polling job, and its failed tries
 * (`posterTries`), so a page that keeps failing is given up on.
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

/** Failed tries (bot check, server error, timeout) before a page is left alone. */
export const POSTER_TRIES = 3;

/** Answers that mean the page is gone: no point asking again. */
const GONE = new Set([404, 410]);

/**
 * How many times a listing's page has failed, or null when its poster is not
 * worth looking for: it has an image, the concert it belongs to (if known)
 * shows one already, or its offer is checked. A seen listing whose concert
 * is gone (deleted, pruned) is not shown anywhere.
 *
 * @param {import('./inbox.js').InboxState} inbox
 * @param {import('./inbox.js').Listing} l
 * @returns {number | null}
 */
function triesSoFar(inbox, l) {
  if (l.image) return null;
  const key = listingKey(l);
  const known = inbox.seen[key];
  if (!known) return 0;
  const c = inbox.concerts[known.concertId];
  if (!c || c.image) return null;
  const offer = c.offers.find((o) => listingKey(o) === key);
  return offer?.posterChecked ? null : (offer?.posterTries ?? 0);
}

/**
 * The job's listings, with posters read from the pages of those that need
 * one: at most `limit`, those tried the fewest times first (so pages that
 * keep failing cannot hold up the rest), each `gapMs` after the previous
 * response. A page that answers, or is gone (404, 410), marks its listing
 * `posterChecked`, poster or not; any other failure counts a try in
 * `posterTries`, and the last of POSTER_TRIES tries marks it checked too.
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
  const todo = listings
    .flatMap((l) => {
      const tries = triesSoFar(inbox, l);
      return tries === null ? [] : [{ l, tries }];
    })
    // A stable sort: in search order within the same count.
    .sort((a, b) => a.tries - b.tries)
    .slice(0, limit);
  /** @type {Map<import('./inbox.js').Listing, Partial<import('./inbox.js').Listing>>} */
  const changes = new Map();
  for (const { l, tries } of todo) {
    await sleep(gapMs);
    const failed = () => {
      const n = tries + 1;
      changes.set(l, { posterTries: n, posterChecked: n >= POSTER_TRIES });
    };
    try {
      const response = await fetch(l.url, {
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (GONE.has(response.status))
        changes.set(l, { image: null, posterChecked: true });
      else if (!response.ok) failed();
      else
        changes.set(l, {
          image: pageImage(await response.text(), l.url, options.ignore),
          posterChecked: true,
        });
    } catch {
      // Network error or timeout.
      failed();
    }
  }
  return listings.map((l) => {
    const change = changes.get(l);
    return change ? { ...l, ...change } : l;
  });
}
