/**
 * Text in the user's language, from extension/_locales through chrome.i18n
 * (Chrome picks the catalog from the browser language, else English).
 * Shared by the pages and the service worker.
 *
 * Message keys are written out as string literals where they are used (the
 * first argument of t, plural, and note; the value of a data-i18n
 * attribute), so a test can check them against the catalog.
 */

/**
 * @param {string} key
 * @param {...(string | number)} args fill `$1`…`$9` in placeholder order
 * @returns {string} the message, or the key itself when it is missing
 */
export const t = (key, ...args) =>
  chrome.i18n.getMessage(key, args.map(String)) || key;

/**
 * `<base>One` when `n` is 1, else `<base>Other` (chrome.i18n has no plural
 * rules; a language without plurals gives both the same text).
 *
 * @param {string} base
 * @param {number} n
 * @param {...(string | number)} args
 */
export const plural = (base, n, ...args) =>
  t(n === 1 ? `${base}One` : `${base}Other`, ...args);

/**
 * @typedef {{ key: string, args: string[] }} Note  an update note, stored
 *   as its message so it shows in the language of the moment
 */

/**
 * @param {string} key
 * @param {...string} args
 * @returns {Note}
 */
export const note = (key, ...args) => ({ key, args });

/**
 * A stored update note as text. Notes from older versions are English text.
 *
 * @param {Note | string | null} n
 * @returns {string | null}
 */
export const noteText = (n) =>
  n === null || typeof n === 'string' ? n : t(n.key, ...n.args);

/**
 * A site error as stored in the schedule (technical English from
 * lib/http.js and lib/job.js) in the user's language; the technical part
 * (status, browser message) stays as it is. Unknown texts show as stored.
 *
 * @param {string} error
 */
export function errorText(error) {
  /** @type {RegExpExecArray | null} */
  let m;
  if (error === 'HTTP 202 (challenge)') return t('errorChallenge');
  if ((m = /^HTTP (\d+)$/.exec(error))) return t('errorHttp', m[1]);
  if ((m = /^challenge page \((.*)\)$/s.exec(error)))
    return t('errorChallengePage', m[1]);
  if (error === 'not a results page (bot check or site change)')
    return t('errorNotResults');
  if ((m = /^network: (.*)$/s.exec(error))) return t('errorNetwork', m[1]);
  if ((m = /^parse: (.*)$/s.exec(error))) return t('errorParse', m[1]);
  return error;
}

const ATTRIBUTES = ['title', 'aria-label', 'placeholder'];

/**
 * Fill a page from its `data-i18n` (text) and `data-i18n-<attribute>`
 * markers, and set its language (fonts pick Japanese glyphs from it). Run
 * before the page adds its own content to these elements.
 *
 * @param {Document} doc
 */
export function localize(doc) {
  doc.documentElement.lang = t('htmlLang');
  for (const el of doc.querySelectorAll('[data-i18n]'))
    el.textContent = t(/** @type {string} */ (el.getAttribute('data-i18n')));
  for (const attr of ATTRIBUTES)
    for (const el of doc.querySelectorAll(`[data-i18n-${attr}]`))
      el.setAttribute(
        attr,
        t(/** @type {string} */ (el.getAttribute(`data-i18n-${attr}`)))
      );
}
