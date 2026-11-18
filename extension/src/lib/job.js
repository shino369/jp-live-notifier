/**
 * One polling job: ask one site about one keyword and return the upcoming
 * listings that really mention the keyword (past shows are dropped). I/O is injected so it runs the same in the
 * service worker and in tests.
 */
import { blockReason, decode, inertHandlers } from './http.js';
import { GAP_MS } from './schedule.js';
import { mentions } from './text.js';

/**
 * @typedef {import('./inbox.js').Listing} Listing
 *
 * @typedef {{ keyword: string, now: Date, page: number }} ParseContext
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   home: string,
 *   format: 'html' | 'json',
 *   searchUrl: (keyword: string) => string,
 *   requests: (keyword: string) => Array<{ url: string, init?: RequestInit }>,
 *   parse: (body: any, ctx: ParseContext) => Listing[],
 *   filterLocally?: boolean,
 *   protection?: string,
 *   expect?: RegExp,
 *   optIn?: { terms: string },
 *   posterFromPage?: { ignore?: RegExp },
 * }} Adapter
 *
 * `requests` usually returns one URL (page 1, newest first); `parse` gets a
 * Document for html adapters and the parsed JSON for json adapters.
 * `filterLocally: false` skips the keyword check for sites whose search is
 * already exact (default true). `protection` names a bot shield (e.g.
 * `akamai`); any failure there may be a block, so the background-tab
 * fallback applies to it. `expect` must match every genuine results page
 * (including "no results"); anything else is treated as a block, so a
 * challenge or error page never passes for "nothing new". `optIn` marks a
 * site whose terms forbid automated access: it is off until the user turns
 * it on, and the settings page says why and links `terms`.
 * `posterFromPage`: the search results carry no image, so the poster is
 * read from each listing's own page (lib/poster.js); `ignore` matches the
 * site-wide image a page shows when the event has none.
 *
 * @typedef {(adapter: Adapter, text: string, ctx: ParseContext) => Promise<Listing[]>} ParseFn
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchFn
 */

/** A bot shield may hold the connection open instead of refusing it. */
export const TIMEOUT_MS = 20_000;

const wait = (/** @type {number} */ ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests of one job go to one site, so each one after the first waits
 * `gapMs` after the previous response (the scheduler spaces whole jobs).
 *
 * @param {{ adapter: Adapter, keyword: string, now: Date, fetch: FetchFn, parse: ParseFn, timeoutMs?: number, gapMs?: number, sleep?: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<{ outcome: import('./schedule.js').Outcome, listings: Listing[] }>}
 */
export async function runJob({
  adapter,
  keyword,
  now,
  fetch,
  parse,
  timeoutMs = TIMEOUT_MS,
  gapMs = GAP_MS,
  sleep = wait,
}) {
  /** @type {Listing[]} */
  const listings = [];
  const requests = adapter.requests(keyword);
  for (let page = 0; page < requests.length; page++) {
    if (page > 0) await sleep(gapMs);
    const { url, init } = requests[page];
    /** @type {Response} */
    let response;
    /** @type {ArrayBuffer} */
    let body;
    try {
      response = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
      });
      // The body can still fail after the headers arrived (timeout, reset).
      body = await response.arrayBuffer();
    } catch (error) {
      return {
        outcome: {
          kind: 'error',
          error: `network: ${String(/** @type {Error} */ (error).message ?? error)}`,
        },
        listings: [],
      };
    }
    const text = decode(body, response.headers.get('content-type'));
    const blocked = blockReason(response.status, text, (n) =>
      response.headers.get(n)
    );
    if (blocked)
      return { outcome: { kind: 'blocked', error: blocked }, listings: [] };
    if (!response.ok) {
      return {
        outcome: { kind: 'error', error: `HTTP ${response.status}` },
        listings: [],
      };
    }
    if (adapter.expect && !adapter.expect.test(text)) {
      return {
        outcome: {
          kind: 'blocked',
          error: 'not a results page (bot check or site change)',
        },
        listings: [],
      };
    }
    try {
      listings.push(
        ...(await parse(adapter, text, { keyword, now, page: page + 1 }))
      );
    } catch (error) {
      return {
        outcome: {
          kind: 'error',
          error: `parse: ${/** @type {Error} */ (error).message}`,
        },
        listings: [],
      };
    }
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const upcoming = [
    ...new Map(listings.map((l) => [l.siteId, l])).values(),
  ].filter((l) => l.dates.length === 0 || l.dates[l.dates.length - 1] >= today);
  const matched =
    adapter.filterLocally === false
      ? upcoming
      : upcoming.filter((l) => mentions(keyword, [l.title, ...l.performers]));
  return { outcome: { kind: 'ok', count: matched.length }, listings: matched };
}

/**
 * Parse in-process: JSON directly, HTML with the given DOMParser (the
 * offscreen document's, or jsdom's in tests), its inline handlers renamed.
 *
 * @param {{ parseFromString(text: string, type: 'text/html'): Document }} domParser
 * @returns {ParseFn}
 */
export const localParse = (domParser) => async (adapter, text, ctx) =>
  adapter.format === 'json'
    ? adapter.parse(JSON.parse(text), ctx)
    : adapter.parse(
        domParser.parseFromString(inertHandlers(text), 'text/html'),
        ctx
      );
