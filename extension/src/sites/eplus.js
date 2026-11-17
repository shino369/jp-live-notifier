/**
 * e+ (イープラス). The search page embeds its first 20 results as JSON in
 * `<script id="json">`; the XHR API behind further pages needs a site token,
 * so only that first page is read. Results are sorted by performance date
 * (no newest-first), which is why the seen index, not the order, decides
 * what is new. Note: e+'s robots.txt disallows /sf/search for crawlers; the
 * extension asks on behalf of one user at a low rate, and the site can be
 * switched off in settings.
 */
import { clean } from '../lib/text.js';
import { listing } from './common.js';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://eplus.jp/sf/search?block=true&keyword=${encodeURIComponent(keyword)}`;

/** `20261121` → `2026-11-21`; `1800` → `18:00` */
const ymd = (/** @type {string} */ s) =>
  `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const hm = (/** @type {string | null | undefined} */ s) =>
  s && /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : null;
/** `20251226180000` → `2025/12/26 18:00` */
const stamp = (/** @type {string | null | undefined} */ s) =>
  s && /^\d{12}/.test(s)
    ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`
    : null;

/**
 * The sale to show: the latest one still open or upcoming, else the last.
 *
 * @param {any[]} sales
 * @param {Date} now
 */
function currentSale(sales, now) {
  const nowStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}0000`;
  const live = sales.filter(
    (s) => (s?.uketsuke_end_datetime ?? '') >= nowStamp
  );
  return (live.length ? live : sales).at(-1);
}

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'eplus',
  name: 'e+',
  home: 'https://eplus.jp/',
  format: 'html',
  expect: /id="json"/,
  searchUrl,
  requests: (keyword) => [{ url: searchUrl(keyword) }],
  parse(doc, { now }) {
    const raw = doc.querySelector('script#json')?.textContent;
    if (!raw) return [];
    const records = JSON.parse(raw)?.data?.record_list ?? [];
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const r of records) {
      const path = r?.koen_detail_url_pc;
      const sub = r?.kanren_kogyo_sub ?? {};
      const title = clean(
        [sub.kogyo_name_1, sub.kogyo_name_2]
          .filter(Boolean)
          .join(' ')
          .replace(/ /g, ' ')
      );
      if (!path || !title) continue;
      /** @type {any[]} */
      const sales = Array.isArray(r.kanren_uketsuke_koen_list)
        ? r.kanren_uketsuke_koen_list
        : [];
      const sale = currentSale(sales, now);
      const dates = [
        ...new Set(String(r.koenbi_term ?? '').match(/\d{8}/g) ?? []),
      ]
        .map(ymd)
        .sort();
      const performers = [
        ...new Set(sales.map((s) => clean(s?.shutsuensha)).filter(Boolean)),
      ];
      out.push(
        listing({
          site: 'eplus',
          siteId: path,
          url: new URL(path, 'https://eplus.jp/').href,
          title,
          performers,
          dates,
          time: hm(r.kaien_time),
          venue: clean(r.kanren_venue?.venue_name) || null,
          prefecture: clean(r.kanren_venue?.todofuken_name) || null,
          saleLabel: sale
            ? clean(
                String(
                  sale.uketsuke_name_pc ?? sale.hambai_hoho_label ?? ''
                ).replace(/^[☆★]+/, '')
              ) || null
            : null,
          saleStart: stamp(sale?.uketsuke_start_datetime),
          saleEnd: stamp(sale?.uketsuke_end_datetime),
        })
      );
    }
    return out;
  },
};
