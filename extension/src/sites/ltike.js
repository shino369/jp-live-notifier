/**
 * ローソンチケット. Server-rendered search (`sort=2&order=desc`: newest sale
 * first). Protected by Akamai Bot Manager: a fetch works only with the
 * browser's own sensor cookies, so failures here are treated as blocks and
 * can fall back to a background tab. Text may be machine-translated in place
 * by WOVN (`<!--wovn-src:原文-->translation`); the Japanese source is read
 * from that comment, and the `data-*` attributes of the order button are
 * preferred because WOVN leaves them alone.
 */
import { clean } from '../lib/text.js';
import { listing, splitPlace, when } from './common.js';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://l-tike.com/search/?keyword=${encodeURIComponent(keyword)}&sort=2&order=desc`;

/**
 * Japanese text of an element: the WOVN source comment when present.
 *
 * @param {Element | null | undefined} el
 */
function jp(el) {
  if (!el) return '';
  for (const node of el.childNodes) {
    if (node.nodeType === 8 && node.textContent?.startsWith('wovn-src:'))
      return clean(node.textContent.slice(9));
  }
  return clean(el.textContent);
}

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'ltike',
  name: 'ローチケ',
  home: 'https://l-tike.com/',
  format: 'html',
  expect: /ResultSearchNumber/,
  protection: 'akamai',
  searchUrl,
  requests: (keyword) => [{ url: searchUrl(keyword) }],
  parse(doc, { now }) {
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const box of doc.querySelectorAll('.ResultBox.prfSummaryItem')) {
      const infos = [
        ...box.querySelectorAll('.ResultBox__informationText'),
      ].map(jp);
      const place = splitPlace(infos[1] ?? '');
      for (const item of box.querySelectorAll('.prfItem')) {
        const btn = item.querySelector('a.entryBtn[data-lcode]');
        const lcode = btn?.getAttribute('data-lcode');
        const title = clean(
          btn?.getAttribute('data-prfname') ||
            jp(box.querySelector('.ResultBox__title'))
        );
        if (!btn || !lcode || !title) continue;
        const prfdate = btn.getAttribute('data-prfdate') ?? '';
        const { dates } = when(
          /^\d{8}$/.test(prfdate)
            ? `${prfdate.slice(0, 4)}/${prfdate.slice(4, 6)}/${prfdate.slice(6)}`
            : (infos[0] ?? ''),
          now
        );
        const period = jp(item.querySelector('#receiptDat'));
        const [saleStart, saleEnd] = period.split(/\s*[～〜~]\s*/);
        const typeName = jp(item.querySelector('#reception_typename'));
        const saleName = jp(item.querySelector('#sale_name'));
        const status = jp(item.querySelector('.ResultBox__status'));
        out.push(
          listing({
            site: 'ltike',
            siteId: [
              lcode,
              btn.getAttribute('data-pfkeys'),
              btn.getAttribute('data-rcptypename'),
              saleName,
            ]
              .filter(Boolean)
              .join(':'),
            url: `https://l-tike.com/order/?gLcode=${encodeURIComponent(lcode)}`,
            title,
            dates,
            venue: clean(btn.getAttribute('data-basevenuename')) || place.venue,
            prefecture: place.prefecture,
            saleLabel: [saleName, typeName].filter(Boolean).join('・') || null,
            saleStart: saleStart || null,
            saleEnd:
              [saleEnd, status && `(${status})`].filter(Boolean).join(' ') ||
              null,
          })
        );
      }
    }
    return out;
  },
};
