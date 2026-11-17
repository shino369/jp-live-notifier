/**
 * 楽天チケット. WordPress search with server-rendered results. The keyword
 * goes in `q` (with an empty `s`); `?s=<keyword>` alone silently returns
 * nothing. Each item is rendered twice (desktop and `-mobile`); only the
 * desktop wrapper is read.
 */
import { clean } from '../lib/text.js';
import { absolute, listing, when } from './common.js';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://ticket.rakuten.co.jp/?s=&q=${encodeURIComponent(keyword)}`;

/** @param {string} title */
const tidy = (title) =>
  clean(title.replace(/【外部サイト】|※楽天ポイントは貯まりません/g, ''));

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'rakuten',
  name: '楽天チケット',
  home: 'https://ticket.rakuten.co.jp/',
  format: 'html',
  expect: /page-count/,
  searchUrl,
  requests: (keyword) => [{ url: searchUrl(keyword) }],
  parse(doc, { now }) {
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const item of doc.querySelectorAll('.list-tpl-item-wrapper')) {
      const a = item.querySelector('.list-tpl-title a[href]');
      const url = absolute(
        a?.getAttribute('href'),
        'https://ticket.rakuten.co.jp/'
      );
      const title = tidy(a?.textContent ?? '');
      if (!url || !title) continue;
      const siteId =
        new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
      const labels = [
        ...item.querySelectorAll('.list-tpl-cst-fld-inline-2 label'),
      ].map((l) => clean(l.textContent));
      const periods = [
        ...item.querySelectorAll('.list-tpl-cst-fld-inline-3'),
      ].map((p) => clean(p.textContent));
      const [start, end] = (periods[0] ?? '').split(/\s*[〜～~]\s*/);
      const { dates, time } = when(
        clean(item.querySelector('.list-tpl-cst-fld-sec-1')?.textContent),
        now
      );
      out.push(
        listing({
          site: 'rakuten',
          siteId,
          url,
          title,
          dates,
          time,
          venue:
            clean(item.querySelector('.list-tpl-cst-fld-sec-2')?.textContent) ||
            null,
          saleLabel: [...new Set(labels)].join(' / ') || null,
          saleStart: start || null,
          saleEnd: end || null,
        })
      );
    }
    return out;
  },
};
