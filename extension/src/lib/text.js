/**
 * Text helpers shared by the adapters and the grouping logic: normalization
 * for matching, string similarity, and Japanese date parsing.
 */

const PUNCT =
  /[\s　・･\-‐‑–—―ー_.,、。!！?？:：;；'"“”‘’「」『』()（）[\]【】〈〉《》<>/／\\|~〜～*＊#＃&＆+＋@＠×☆★♪◆◇■□●○※]/g;

/**
 * Fold a string for matching: NFKC (full-width → half-width), lower case,
 * hiragana → katakana, punctuation and spaces removed.
 *
 * The long-vowel mark ー is removed too, so 「ヨルシカ」 and 「ヨルシカー」 differ
 * only by the extra letter; that is acceptable for substring matching.
 *
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function fold(text) {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(PUNCT, '');
}

/**
 * Tidy text for display: NFKC (full-width letters and digits → half-width,
 * half-width kana → full-width) and collapsed whitespace.
 *
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function clean(text) {
  return (text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** @param {string} s */
function bigrams(s) {
  /** @type {Map<string, number>} */
  const grams = new Map();
  if (s.length === 1) grams.set(s, 1);
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/**
 * Dice coefficient on character bigrams of the folded strings, 0..1.
 * One string containing the other counts as 1.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return 0;
  if (x === y || x.includes(y) || y.includes(x)) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) ?? 0);
  const total = [...gx.values(), ...gy.values()].reduce((s, n) => s + n, 0);
  return (2 * shared) / total;
}

/**
 * Whether `keyword` occurs in any of `fields` after folding.
 *
 * @param {string} keyword
 * @param {Array<string | null | undefined>} fields
 * @returns {boolean}
 */
export function mentions(keyword, fields) {
  const k = fold(keyword);
  if (!k) return false;
  return fields.some((f) => fold(f).includes(k));
}

/** @param {number} y @param {number} m @param {number} d */
const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** @param {number} y @param {number} m @param {number} d */
function valid(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const DATE_RE =
  /(?:(\d{4})\s*[年/.-]\s*)?(\d{1,2})\s*[月/.-]\s*(\d{1,2})(?!\d)\s*日?/g;
const TIME_RE = /(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/;

/**
 * Find calendar dates in Japanese listing text, e.g. `2026/12/05(土)`,
 * `2026年12月5日`, `12/5(土)`, `2026.12.05`. Dates without a year take the
 * year of `ref`, or the next year when that would put them more than 60 days
 * in the past. A range `A～B` yields both ends.
 *
 * @param {string | null | undefined} text
 * @param {Date} ref "today" for year inference
 * @returns {string[]} sorted unique ISO dates (YYYY-MM-DD)
 */
export function parseDates(text, ref) {
  const out = new Set();
  const refYear = ref.getFullYear();
  const floor = new Date(ref.getTime() - 60 * 86_400_000);
  let lastYear = 0;
  for (const m of (text ?? '').normalize('NFKC').matchAll(DATE_RE)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    let year = m[1] ? Number(m[1]) : lastYear || refYear;
    if (!m[1] && !lastYear && new Date(year, month - 1, day) < floor) year++;
    if (!valid(year, month, day)) continue;
    if (m[1]) lastYear = year;
    out.add(iso(year, month, day));
  }
  return [...out].sort();
}

/**
 * The first clock time in the text (`18:00`, `18：30`), or null.
 *
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function parseTime(text) {
  const m = TIME_RE.exec((text ?? '').normalize('NFKC'));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/**
 * Short stable hash (FNV-1a, base 36) for ids.
 *
 * @param {string} text
 * @returns {string}
 */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
