/**
 * DOM helpers for the HTML adapters.
 */
import { clean, parseDates, parseTime } from '../lib/text.js';

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {string}
 */
export const text = (root, selector) =>
  clean(root.querySelector(selector)?.textContent);

/**
 * Text of an element without the label child (e.g. `<p><span>会場</span>X</p>` → X).
 *
 * @param {Element | null | undefined} el
 * @param {string} labelSelector
 * @returns {string}
 */
export function textWithout(el, labelSelector) {
  if (!el) return '';
  const copy = /** @type {Element} */ (el.cloneNode(true));
  copy.querySelectorAll(labelSelector).forEach((n) => n.remove());
  return clean(copy.textContent);
}

/**
 * Absolute URL against a base, or null.
 *
 * @param {string | null | undefined} href
 * @param {string} base
 */
export function absolute(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Split `会場名（東京都）` / `会場名(東京都)` into venue and prefecture.
 *
 * @param {string} place
 * @returns {{ venue: string | null, prefecture: string | null }}
 */
export function splitPlace(place) {
  const m = /^(.*?)[\s　]*[（(]([^（()）]*?(?:都|道|府|県))[)）]\s*$/.exec(
    place
  );
  if (m) return { venue: clean(m[1]) || null, prefecture: m[2] };
  return { venue: clean(place) || null, prefecture: null };
}

/**
 * @param {string} dateText
 * @param {Date} now
 */
export const when = (dateText, now) => ({
  dates: parseDates(dateText, now),
  time: parseTime(dateText),
});

/**
 * Blank listing fields, so adapters only set what they know.
 *
 * @param {Pick<import('../lib/inbox.js').Listing, 'site' | 'siteId' | 'url' | 'title'> & Partial<import('../lib/inbox.js').Listing>} base
 * @returns {import('../lib/inbox.js').Listing}
 */
export const listing = (base) => ({
  performers: [],
  venue: null,
  prefecture: null,
  dates: [],
  time: null,
  saleLabel: null,
  saleStart: null,
  saleEnd: null,
  image: null,
  ...base,
});
