/**
 * LivePocket. Server-rendered search, newest published first (`sort=3`).
 * Protected by an AWS WAF challenge (HTTP 202 + `x-amzn-waf-action`): a
 * fetch works only while the browser holds a fresh `aws-waf-token` cookie
 * (visit the site once, or enable the background-tab fallback). The search
 * is token-based and loose, so results are filtered locally.
 */
import { clean } from '../lib/text.js';
import {
  absolute,
  listing,
  splitPlace,
  text,
  textWithout,
  when,
} from './common.js';

const BASE = 'https://livepocket.jp/';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://livepocket.jp/event/search?word=${encodeURIComponent(keyword)}&sort=3`;

/** @param {Element} card @param {string} label */
const field = (card, label) => {
  const span = card.querySelector(label);
  return textWithout(span?.parentElement, label);
};

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'livepocket',
  name: 'LivePocket',
  home: BASE,
  format: 'html',
  expect: /event-list-sort__text|検索結果が見つかりませんでした/,
  protection: 'aws-waf',
  searchUrl,
  requests: (keyword) => [{ url: searchUrl(keyword) }],
  parse(doc, { now }) {
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const card of doc.querySelectorAll(
      'ul.event-card-list > li.event-card-list__item a.event-card'
    )) {
      const url = absolute(card.getAttribute('href'), BASE);
      const title = text(card, '.event-card__title');
      if (!url || !title) continue;
      const siteId =
        new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
      const dateText = field(card, '.event-card__date');
      const { dates } = when(dateText, now);
      const { time } = when(field(card, '.event-card__time'), now);
      const { venue, prefecture } = splitPlace(
        field(card, '.event-card__place')
      );
      const cast = field(card, '.event-card__cast');
      out.push(
        listing({
          site: 'livepocket',
          siteId,
          url,
          title,
          dates,
          time,
          venue,
          prefecture,
          performers: cast
            ? cast
                .split(/\s*[/／、,]\s*/)
                .map(clean)
                .filter(Boolean)
            : [],
          saleLabel: text(card, '.event-card__tag') || null,
          image:
            card.querySelector('.event-card__image img')?.getAttribute('src') ??
            null,
        })
      );
    }
    return out;
  },
};
