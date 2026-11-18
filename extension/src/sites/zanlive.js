/**
 * ZAN-LIVE (Z-aN), streaming and venue events, mostly VTuber and anime
 * music. There is no search and no API: the server-rendered home page lists
 * every featured event (upcoming, new, lottery open, pickup, popular,
 * archive) in `div.c-event-card`s, and the keyword is matched locally on the
 * title (performers are only free text on the detail page). One request per
 * job; no bot shield.
 */
import { absolute, listing, text, when } from './common.js';

const BASE = 'https://www.zan-live.com/ja/';

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'zanlive',
  name: 'ZAN-LIVE',
  home: BASE,
  format: 'html',
  // 利用規約 第6条(17)(18): no access by bots or other automated means.
  optIn: { terms: 'https://www.zan-live.com/ja/info/terms.html' },
  expect: /c-event-card__title/,
  searchUrl: () => BASE,
  requests: () => [{ url: BASE }],
  parse(doc, { now }) {
    /** @type {Map<string, import('../lib/inbox.js').Listing>} */
    const byId = new Map();
    for (const card of doc.querySelectorAll('div.c-event-card')) {
      const url = absolute(card.querySelector('a')?.getAttribute('href'), BASE);
      const title = text(card, '.c-event-card__title');
      const siteId = url && /\/live\/detail\/(\d+)/.exec(url)?.[1];
      if (!url || !siteId || !title) continue;
      const { dates, time } = when(text(card, '.c-event-card__date'), now);
      const venue = card.querySelector('.c-event-card__badge.venue');
      const online = card.querySelector('.c-event-card__badge.online');
      const lottery = card.closest('#lottery-open-events') !== null;
      const seen = byId.get(siteId);
      // The same event shows up in several sections; merge what each knows.
      byId.set(
        siteId,
        listing({
          site: 'zanlive',
          siteId,
          url,
          title,
          dates: dates.length ? dates : (seen?.dates ?? []),
          time: time ?? seen?.time ?? null,
          venue: online && !venue ? 'オンライン' : (seen?.venue ?? null),
          saleLabel: lottery ? '抽選受付中' : (seen?.saleLabel ?? null),
          image:
            card
              .querySelector('.c-event-card__thumbnail img')
              ?.getAttribute('src') ??
            seen?.image ??
            null,
        })
      );
    }
    return [...byId.values()];
  },
};
