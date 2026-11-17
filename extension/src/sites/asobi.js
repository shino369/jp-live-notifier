/**
 * ASOBI TICKET (Bandai Namco). The Angular app reads an open JSON:API at
 * asobi-ticket.api.app.t-riple.com. There is no keyword search: the adapter
 * lists every public booth (event) and the keyword is matched locally.
 * Venue, prefecture, and performance dates are only in login-only endpoints;
 * the date comes from the booth slug's `-yymmdd` suffix, a site convention.
 */
import { clean } from '../lib/text.js';
import { listing } from './common.js';

const API =
  'https://asobi-ticket.api.app.t-riple.com/api/v1/public/booths?page=1&per_page=100';
const WEB = 'https://asobiticket2.asobistore.jp';

/** @param {string} slug */
function slugDate(slug) {
  const m = /-(?:20)?(\d{2})(\d{2})(\d{2})$/.exec(slug);
  if (!m) return [];
  const [y, mo, d] = [2000 + Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? [`${y}-${m[2]}-${m[3]}`]
    : [];
}

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'asobi',
  name: 'ASOBI TICKET',
  home: `${WEB}/`,
  format: 'json',
  searchUrl: () => `${WEB}/`,
  requests: () => [
    { url: API, init: { headers: { accept: 'application/json' } } },
  ],
  parse(json) {
    const images = new Map(
      (json?.included ?? [])
        .filter((/** @type {any} */ x) => x?.type === 'image')
        .map((/** @type {any} */ x) => [
          x.id,
          x.attributes?.reading_urls?.small ??
            x.attributes?.reading_urls?.medium ??
            null,
        ])
    );
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const booth of json?.data ?? []) {
      const a = booth?.attributes ?? {};
      const slug = a.slug ?? booth.id;
      if (!slug || !a.name || (a.status && a.status !== 'public')) continue;
      const open = Number(a.entry_opening_receptions_count ?? 0);
      out.push(
        listing({
          site: 'asobi',
          siteId: slug,
          url: `${WEB}/booths/${encodeURIComponent(slug)}`,
          title: clean(a.name),
          dates: slugDate(slug),
          // A plain status: the count would drop when one reception closes
          // and read as a new sale. A new reception moves saleStart instead.
          saleLabel: open > 0 ? '受付中' : null,
          saleStart: a.recent_reception_entry_period_starts_at ?? null,
          image: images.get(booth.relationships?.cover_image?.data?.id) ?? null,
        })
      );
    }
    return out;
  },
};
