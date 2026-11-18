/**
 * ZAIKO, tickets for venue and streaming events. The search page is a
 * Laravel + Inertia app: the server-rendered HTML carries the page data as
 * JSON in `<script data-page="app">`, whose `props.results` are the hits
 * (at most 5, fuzzy on titles and organizer names, no sort). A hit has only
 * an id, title, poster, and event URL on the organizer's subdomain: no
 * dates, venue, or performers, so the keyword is matched on the title and
 * past events cannot be told apart. No bot shield (CloudFront, rate limited
 * at 30 searches per window).
 */
import { clean } from '../lib/text.js';
import { listing } from './common.js';

/** @param {string} keyword */
const searchUrl = (keyword) =>
  `https://zaiko.io/ja/search?q=${encodeURIComponent(keyword)}`;

/** @param {unknown} url */
const httpsUrl = (url) => {
  try {
    return typeof url === 'string' && new URL(url).protocol === 'https:'
      ? url
      : null;
  } catch {
    return null;
  }
};

/** @type {import('../lib/job.js').Adapter} */
export default {
  id: 'zaiko',
  name: 'ZAIKO',
  home: 'https://zaiko.io/ja',
  format: 'html',
  // 利用規約 第8条(7): no access by bots or other automated means.
  optIn: { terms: 'https://zaiko.io/ja/terms' },
  expect: /data-page="app"[\s\S]*"component":"Main\\\/Search"/,
  searchUrl,
  requests: (keyword) => [{ url: searchUrl(keyword) }],
  parse(doc) {
    const data = doc.querySelector('script[data-page="app"]')?.textContent;
    /** @type {any[]} */
    const results = data ? (JSON.parse(data)?.props?.results ?? []) : [];
    /** @type {import('../lib/inbox.js').Listing[]} */
    const out = [];
    for (const r of results) {
      const url = httpsUrl(r?.action?.url);
      const title = clean(r?.title);
      if (!url || !title || r?.id == null) continue;
      out.push(
        listing({
          site: 'zaiko',
          siteId: String(r.id),
          url,
          title,
          image: httpsUrl(r.imageUrl),
        })
      );
    }
    return out;
  },
};
