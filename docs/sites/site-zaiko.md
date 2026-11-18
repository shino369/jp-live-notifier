# ZAIKO (https://zaiko.io/) - study (fetched 2026-11-18)

## Verdict

- Public API: none documented. No RSS/Atom. `robots.txt`: `Disallow: *?lang=*`, `*&lang=*`, `/account/`, `/my/`, `/guests/eticket/`; `Sitemap: https://zaiko.io/sitemap.xml` (not opened). `/ja/search` and `/ja/events/*` are allowed.
- The site is Laravel + Inertia.js (Vue 3) behind CloudFront. Every page is server-rendered and carries its Inertia page object in `<script data-page="app" type="application/json">`. No JS rendering needed, no CSRF token needed for GET.
- Keyword search works with a plain GET but is **weak**: title/creator-name oriented, hard-capped at 5 results, no dates, no venue, no sale info (see below). Adapter can only emit id, title, url, image from it.
- No bot challenge seen. Terms (第8条(7)) forbid bot access: see Terms. Decision for the owner.

## Search request

```sh
curl -sS -A "$CHROME_UA" -G --data-urlencode 'q=<keyword>' 'https://zaiko.io/ja/search'
```

- GET, no cookies or tokens needed (server sets `__cookie_consent`, `lang`, `XSRF-TOKEN`, `zaiko_session`; none required). `/ja/search` is the Japanese UI path; Bare `/search` was not tested. Do not add `?lang=` (robots disallow).
- Param `q` (max 255 chars). `page`, `limit`, `per_page` are ignored (tested: same 5 ids). No sort parameter. So at most 5 hits per keyword.
- HTML response, ~92-100 KB, `content-type: text/html; charset=utf-8`, `cache-control: no-cache, private`.
- Alternative, the Inertia JSON form (2 KB with partial reload headers, 22 KB without): needs `X-Inertia: true` AND `X-Inertia-Version: <asset hash>` (currently `b706fe80fa32ea257b401bcdda0d36f6`, changes on every deploy). A missing or stale version returns `409` with an empty body. Not recommended: use the HTML page, which needs no special headers.
- A request with the default `curl/*` user agent got `403` (919-byte nginx-style error page). A Chrome UA is fine; a service worker sends one.

### What the search matches (observed)

| Keyword                    | Hits                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TrySail`                  | 2, both with TrySail in the title                                                                                      |
| `蒼星すい` / `Eternal`     | title match (`蒼星すい 1st one-man Live "Eternal Glow"`); `蒼星すい` also adds an unrelated hit                        |
| `上坂すみれ`               | 2, title match                                                                                                         |
| `AKB48`                    | 5 whose titles do NOT contain AKB48 (`11月30日 18:30開演 ...`); matched through the creator (`akb48.zaiko.io`) or tags |
| `ヨルシカ`                 | 5 unrelated (`夜の部`, `夜公演`): fuzzy/phonetic noise, no ヨルシカ event on ZAIKO                                     |
| `キタニタツヤ`             | 4 unrelated                                                                                                            |
| `ヰ世界情緒`               | 1 unrelated (`かんてゐく ...`)                                                                                         |
| `ずっと真夜中でいいのに。` | 0                                                                                                                      |
| `zzqxjwv` (nonsense)       | 0                                                                                                                      |

- Matching is fuzzy and relevance-ranked, so noise is common and a creator-name match returns titles without the keyword. A strict local filter on title (the extension default) would drop the genuine creator matches (AKB48 case) but is needed to drop the noise. Performer names are NOT in the results, so artist-only matches cannot be confirmed from the search page.
- Major commercial artists (ヨルシカ, キタニタツヤ, ヰ世界情緒) have no listings: ZAIKO is mostly indie, idol, theatre, club and streaming events.
- Includes online streaming and archive events together with venue events, mixed in one list with no flag. Past events: an already finished archive event (`マッハスピード豪速球 単独新作コントライブ`, archive until 12-17) is returned, so past/archived items do appear; the search result has no date to filter on.

## Search result data (`data-page` JSON)

Parse: `JSON.parse(doc.querySelector('script[data-page="app"]').textContent)` (DOMParser is enough; the text is plain JSON, not HTML-escaped). `component` is `Main/Search`.

| Field         | Path (under `props`)                       | Notes                                                                                      |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| query echo    | `query`                                    | the `q` value                                                                              |
| result list   | `results[]`                                | `[]` when nothing found; max 5                                                             |
| stable id     | `results[].id` (number, = `action.dataId`) | ZAIKO event id, e.g. `386546`                                                              |
| title         | `results[].title`                          |                                                                                            |
| image         | `results[].imageUrl`                       | `https://media.zaiko.io/zaiko/bw_1000/bh_1000/pf_1/<code>` (1000x1000 square)              |
| event URL     | `results[].action.url`                     | on the organizer's subdomain: `https://<creator>.zaiko.io/ja/e/<slug>`; `dataType` `EVENT` |
| performers    | not present                                |                                                                                            |
| dates / time  | not present                                | detail page only                                                                           |
| venue / pref. | not present                                | detail page only                                                                           |
| sale status   | not present                                |                                                                                            |

Other props (`ziggy`, `footer`, `mainNav`, `csrf_token`) are page chrome and carry a CSRF token (redacted in fixtures).

## Richer listing pages (same Inertia shape, plain GET)

`https://zaiko.io/ja/events/category/concerts-live-music?page=<n>`, `/ja/events/upcoming`, `/ja/events/popular`, `/ja/events/recent_archives`. Component `Main/ItemGroup`; props `group.items[]`, `page`, `hasMore`. 30 items per page; the live-music list ended before page 10 (about 7-9 pages, 200-270 events). Sorted by start date ascending (soonest first); no keyword parameter (`?q=` ignored). `/events/popular` is popularity-ordered, `/events/recent_archives` has no start date.

| Field                                 | Path (`props.group.items[]`)                                           | Example                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| id                                    | `id` (= `action.dataId`)                                               | `385607`                                                                                  |
| title                                 | `title`                                                                | `中村さんそ / ﾕｷﾑﾗﾁｬﾝ！ / ちょこ`                                                         |
| event URL                             | `action.url`                                                           | `https://wallwall.zaiko.io/ja/e/20261120nyt`                                              |
| image                                 | `imageUrl`                                                             |                                                                                           |
| venue + pref.                         | `details[0].content` when `details[0].iconUrl` ends `offline-icon.svg` | `表参道WALL&WALL, 東京都` (last `, ` part is the prefecture or, abroad, the region)       |
| online flag                           | `details[0].content === '配信'` (`online-icon.svg`)                    | streaming event, no venue                                                                 |
| date text                             | `details[1].content` (`calendar-icon.svg`)                             | `11月20日 (金) 18:30`; online adds ` JST`; `11月21日 (土) 開始時間未定` when time unknown |
| archive end                           | `details[2].content` (`archive-icon.svg`), online only                 | `12月19日 (土)まで見逃し配信`                                                             |
| start ISO                             | `tags[0].name` = `{{2026-11-20T18:30:00+09:00\|countdown}}`            | regex `\{\{([^                                                                            | ]+)\|countdown\}\}`; offset is the venue's zone (US events `-08:00`); `T00:00:00` = time undecided |
| sale status / sale start / performers | not present                                                            |                                                                                           |

Date text has no year; take the year from the ISO in `tags[0].name`. The `recent_archives` list has `details` = archive-until / `に配信済み` and no tags.

## Detail page (organizer subdomain, `https://<creator>.zaiko.io/ja/e/<slug>`)

~108 KB HTML; `x-ratelimit-limit: 6`. Has JSON-LD `<script type="application/ld+json">` with `@graph[0]` `MusicEvent`: `name`, `url`, `image`, `startDate`/`endDate` (ISO with `+09:00`), `location.name`, `location.address.addressRegion` (prefecture), `offers[].name/validFrom/availability/price`, `eventAttendanceMode` (`OfflineEventAttendanceMode` vs online), `performer[].name`, `organizer.name`. Inertia `props.event` has `display_date_period.start.datetime_string`, `display_open_date`, `details` (HTML free text). Event pages are on the creator's own subdomain, so a detail fetch needs `*://*.zaiko.io/*` in `host_permissions`. Sale end and the sale label are not in JSON-LD; offers `availability` (`InStock`) plus `validFrom` give sale status and start. Only worth fetching for new, keyword-matching hits.

## Protection, limits

- CloudFront (`via: ... cloudfront.net`, `x-amz-cf-pop`), origin `nginx`. No challenge, no WAF cookie, no Cloudflare/Akamai. About 25 requests over the session, 3 s apart, no blocks.
- Rate limit headers: `x-ratelimit-limit: 30` on `/ja/search`, `100` on `/ja/events/*`, `6` on creator microsites (per-minute assumed, not verified). `x-ratelimit-remaining` decremented by 1 per request. Behavior at 0 not tested.
- Needed headers: Chrome UA only (default curl UA is 403). `Accept-Language: ja` not needed (path `/ja/` sets it). Cookies not needed.
- CSP/`vary: X-Inertia`. HTML is `cache-control: no-cache, private`.

## Page shape markers (for `expect`)

- Correct page (results or none): the HTML contains `<script data-page="app" type="application/json">` and `"component":"Main\/Search"` is inside it as `"component": "Main/Search"` (the HTML form has a space after the colon and an unescaped slash; match loosely, e.g. `/data-page="app"[\s\S]*Main\\?\/Search/`).
- No results: `"results": []` in that JSON (the Vue `search-no-results` text is client-rendered and not in the HTML). Parser should treat `results === []` as empty and anything unparsable as a block.
- Empty or missing `q` gives `results: null` (page without the list): do not send it.
- Error/blocked: `403` small HTML, `409` empty (Inertia version mismatch, only for X-Inertia requests).

## Terms (https://zaiko.io/ja/terms, 第8条 禁止行為)

(7) 「ボット等含む自動化された手段によって本サービス（コンテンツを含みます。）にアクセスする行為（本サービスの一般的に入手可能なサーチインデックスの作成のみを目的として、…サーチエンジン上で個人的に行われるサーチによるものを除きます。）」 - accessing the service by automated means including bots is a prohibited act, with a narrow search-engine exception. Also (12) forbids collecting third-party personal data without consent (not relevant here). robots.txt itself allows the search and list URLs. The extension is a user-run personal tool, a few polite requests; whether to ship a ZAIKO adapter in spite of clause (7) is the owner's decision.

## Recommendation for the adapter (id `zaiko`, name `ZAIKO`)

- `format: 'html'`; `home: 'https://zaiko.io/ja/'`; `searchUrl: k => https://zaiko.io/ja/search?q=<enc k>`; `requests: k => [{ url: searchUrl(k) }]` (no special headers; the extension's Chrome UA applies). One request, no pagination possible.
- `parse(doc)`: read `script[data-page="app"]`, `JSON.parse`, take `props.results`. Map each to a listing: `site 'zaiko'`, `siteId String(id)`, `url action.url`, `title`, `image imageUrl`, `dates []`, venue/prefecture null, no performers, no sale fields.
- `filterLocally`: keep the default `true` to remove the fuzzy noise (ヨルシカ → 夜), accepting that creator-only matches such as AKB48 are lost; or `false` and accept noise. Recommend `true`.
- `protection`: none (omit). `expect`: `/data-page="app"[\s\S]*?Main\\?\/Search/`.
- Because results carry no date, the "past shows are dropped" rule cannot apply; archive/finished events will be reported. Optional second stage: crawl `/ja/events/category/concerts-live-music?page=1..9` (HTML or Inertia JSON) for dates/venues and join by `id`, or fetch the detail page JSON-LD for new hits.

## Fixtures (`test/fixtures/`, tokens replaced with REDACTED)

- `zaiko-trysail.html`: search `q=TrySail`, 2 results (online events). `zaiko-yorushika.html`: `q=ヨルシカ`, 5 fuzzy, unrelated results. `zaiko-noresult.html`: `q=zzqxjwv`, `results: []`. All ~95-100 KB, plain GET HTML.
- `zaiko-category-concerts.json`: Inertia JSON for `/ja/events/category/concerts-live-music` page 1 (30 items, trimmed to `group`, `page`, `hasMore`).

## Risks and not determined

- Search quality (5-result cap, fuzzy ranking) is the main limit; popular artists may never appear in the first 5 for broad keywords.
- Rate-limit window and the behavior at the limit; whether non-browser headers get blocked later.
- Page structure may change with Inertia/Vue redeploys (the `data-page` contract is stable, the prop names are not guaranteed).
- Detail-page sale end time not located; no performer data outside the detail JSON-LD.
- Did not test the English/other locales or whether `/search` without `/ja` differs.

## Headless browsers (checked 2026-11-18)

The search answers 403 to a `HeadlessChrome/…` user agent and 200 to the same request with
`Chrome/…`, so it works from a normal Chrome but not from headless Playwright (as with ローチケ).
