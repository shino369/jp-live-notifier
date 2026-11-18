/**
 * チケットぴあ. The search page is a JS shell; its results come from
 * `rlsInfo.do`, an HTML fragment with schema.org microdata. One
 * `section.sales_data` per event, one `.event_link` per sale/performance.
 * The search is fuzzy, so results are filtered locally.
 */
import { clean } from '../lib/text.js';
import { absolute, listing, text, when } from './common.js';

const BASE = 'https://t.pia.jp/';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://t.pia.jp/pia/search_all.do?kw=${encodeURIComponent(keyword)}`;

/** @param {string} keyword @param {number} page */
const apiUrl = (keyword, page) =>
  `https://t.pia.jp/pia/rlsInfo.do?kw=${encodeURIComponent(keyword)}&cAsgnFlg=false&bAsgnFlg=false&includeSaleEnd=false&page=${page}&responsive=true&noConvert=true&searchMode=1&mode=2&dispMode=1`;

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'pia',
  name: 'チケットぴあ',
  home: 'https://t.pia.jp/',
  // ぴあ会員規約 第12条(12) forbids using the service through BOTs (written
  // for members; the extension does not log in, but off until the user opts in).
  optIn: { terms: 'https://t.pia.jp/info/terms.jsp' },
  format: 'html',
  expect: /ptotalcnt/,
  searchUrl,
  requests: (keyword) => [1, 2].map((page) => ({ url: apiUrl(keyword, page) })),
  parse(doc, { now }) {
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const section of doc.querySelectorAll('section.sales_data')) {
      const head = section.querySelector('.sales_data_title a');
      const title = clean(head?.textContent);
      if (!title) continue;
      const eventUrl = absolute(head?.getAttribute('href'), BASE);
      for (const link of section.querySelectorAll('.event_link')) {
        const a =
          link.querySelector('a[itemprop=url]') ?? link.querySelector('a');
        const url = absolute(a?.getAttribute('href'), BASE) ?? eventUrl;
        if (!url) continue;
        const q = new URL(url).searchParams;
        const id =
          [q.get('eventCd'), q.get('rlsCd'), q.get('perfCd')]
            .filter(Boolean)
            .join(':') || url;
        const label = text(link, 'li.is_title').split('/')[0].trim() || null;
        const startAttr =
          link
            .querySelector('time[itemprop=startDate]')
            ?.getAttribute('datetime') ?? '';
        const dateText = text(link, 'li.is_date');
        const { dates, time } = when(
          `${startAttr.slice(0, 10)} ${dateText}`,
          now
        );
        const status = text(link, 'li.is_status');
        out.push(
          listing({
            site: 'pia',
            siteId: id,
            url,
            title,
            dates,
            time,
            venue: text(link, '.is_place [itemprop=name]') || null,
            prefecture: text(link, '[itemprop=addressRegion]') || null,
            saleLabel: label,
            saleEnd: status || null,
          })
        );
      }
    }
    return out;
  },
};
