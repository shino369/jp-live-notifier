# ASOBI TICKET (https://asobiticket2.asobistore.jp/) - study (fetched 2026-11-17)

## Verdict

- The site is an Angular SPA (`<app-root>`, `main-U6LAVQ6H.js`, 43 lazy chunks). The HTML shell (487 KB, `asobi-spa-shell.html`) contains no event data. No `__NEXT_DATA__`/embedded JSON.
- It calls an undocumented but unauthenticated JSON:API-style REST API (Rails backend, "t-riple" platform) found in the bundle environment config: `apiEndpoint: "https://asobi-ticket.api.app.t-riple.com/api"`, tenant `asobi-ticket`.
- No keyword search endpoint. The API lists all public receptions (sale rounds) and booths (event pages); filter locally by keyword. `keyword=` on `/v1/public/booths` is silently ignored (returned all 15).
- No RSS. `/sitemap.xml` returns the SPA shell (not a sitemap). robots.txt returns the SPA shell (no rules, no Disallow).

## Bot protection

- API host (`asobi-ticket.api.app.t-riple.com`): behind Fastly/varnish, plain curl with any UA and no Origin/cookies -> HTTP 200 JSON. CORS allows `https://asobiticket2.asobistore.jp` origin; an extension service worker with the host in host_permissions does not need CORS. `cache-control: no-store`. The SPA sends header `x-app-version` (not required) . Private endpoints (`/v1/private/...`) return 401 `authentication_error` (login needed; not touched).
- Web host: Cloudflare, sets a `__cfwaitingroom` cookie on HTML requests, no challenge seen. Waiting room could throttle the HTML during on-sale spikes; the API is not behind it (observed). Not needed by the extension.
- Rate limits: none observed in ~15 requests. Unknown thresholds. Poll every 15-30 min at most.

## Endpoints (all GET, no auth)

1. List of event pages (best discovery, 15 KB):

```
curl -sS -A "$UA" "https://asobi-ticket.api.app.t-riple.com/api/v1/public/booths"
```

Response headers `Total: 15`, `Per-Page: 20` (exposed header); `page`/`per_page` accepted (`per_page=2&page=2` returns the second page). JSON:
`data[].id` = `attributes.slug` (e.g. `cinderellagirls-270111`), `attributes.name` (event/tour title), `attributes.status` ("public"), `attributes.entry_opening_receptions_count` (rounds currently open), `attributes.recent_reception_entry_period_starts_at` (ISO +09:00, latest round start), `relationships.cover_image.data.id` -> `included[type=image].attributes.reading_urls.{small,medium,large,original}`. 2. All sale rounds (1 MB uncompressed, unpaginated, `page/per_page` ignored; includes long HTML bodies):

```
curl -sS -A "$UA" "https://asobi-ticket.api.app.t-riple.com/api/v1/public/receptions"
curl -sS -A "$UA" "https://asobi-ticket.api.app.t-riple.com/api/v1/public/receptions?booth_slug=<slug>"   # 75 KB for one booth
```

`data[]` (type `reception`): `id` (UUID, stable), `attributes.name` (round name, e.g. アソビストア一般会員先行, 一般販売（先着）, リセール), `entry_type` (`lottery` or first-come), `entry_period_status` (`within_entry_period` ...), `entry_period_starts_at`, `entry_period_ends_at`, `result_announcement_scheduled_at`, `deposit_period_starts_at/ends_at`, `member_rank_authorization_required`, `authorized_member_ranks`; `relationships.tour.data.id` (tour slug) -> `included[type=tour].attributes.name` (event title) and `.relationships.booth.data.id` (booth slug). Sorted newest entry_period_starts_at first (observed). 39 rounds returned.
Also: `/v1/public/news_items?page=1&per_page=5` (announcements; `attributes.name`), `/v1/public/booths/<slug>`, `/v1/public/receptions/<id>/access_control`. `/v1/public/tours`, `/v1/public/receptions/<id>` and `/acts` are 404.

## Field map

| Need                     | Source                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| event/tour title         | booths `data[].attributes.name`; or receptions `included[type=tour].attributes.name`                                                                                                                                                                                                                                                                                                                                                     |
| artist/performer         | NOT a field; extract by local keyword match on title (e.g. THE IDOLM@STER ... )                                                                                                                                                                                                                                                                                                                                                          |
| stable ID                | booth `id`/slug; reception `id` UUID (new sale round = new UUID)                                                                                                                                                                                                                                                                                                                                                                         |
| sale type + period       | reception `attributes.name` (先行 / 一般 / リセール), `entry_type`, `entry_period_starts_at` / `ends_at`, `result_announcement_scheduled_at`                                                                                                                                                                                                                                                                                             |
| ticket detail URL        | booth: `https://asobiticket2.asobistore.jp/booths/<slug>`; reception: `https://asobiticket2.asobistore.jp/receptions/<id>` (route names from the Angular router; HTTP 200 SPA shell, not content-verified)                                                                                                                                                                                                                               |
| venue, prefecture, dates | NOT public. Acts (`prefecture_code`, `venue`, `performance_date`, `opens_at`, `performance_starts_at`) come from `/v1/private/receptions/<id>/acts` (401, login). Public receptions `included[type=act]` only for resale rounds (2 of 39): `attributes.venue`, `prefecture_code` (JIS, 14 = 神奈川), `performance_date`. Booth slug usually ends with yymmdd of the event (e.g. `cinderellagirls-270111` = 2027-01-11) - heuristic only. |

## Parsed sample (from `asobi-booths.json` and `asobi-receptions-all.json`)

1. booth `cinderellagirls-261128` | THE IDOLM@STER CINDERELLA GIRLS 15th ANNIVERSARY PARTY!!!! ～ for your ONE ～ | open rounds 4 | latest start 2026-11-12T13:00+09:00
2. reception `bebd8d4b-9a4f-4c9f-b224-35d1808ddc84` | アソビストア一般会員先行 | lottery | entry 2026-11-13T12:00 -> 2026-11-29T23:59 +09:00 | results 2026-12-11T13:00 | tour `cinderellagirls-15th-orchestra` -> booth `cinderellagirls-270111`
3. resale reception `d9c0888d...` | リセール（11月28日(土)公演） | act 11/28(土)Kアリーナ横浜, prefecture_code 14, 2026-11-28 open 15:30 start 17:00

## Fixtures

`asobi-booths.json` (15 KB), `asobi-receptions-all.json` (1.02 MB), `asobi-receptions-booth-cinderellagirls-270111.json`, `asobi-receptions-none.json` (`{"data":[],"included":[]}` for unknown slug), `asobi-news.json`, `asobi-spa-shell.html` (487 KB, proves the shell has no data).

## asobistore.jp

`https://asobistore.jp/content/event-ticket/` and `/event-ticket/List` return a 4.9 KB static page (an S3 "page" announcing a rename of the 先行 section) with no event listing in server HTML; the actual event list is not available through curl and I did not find its source. sitemap.xml/content/event return the same 404-style S3 page. Treat asobistore.jp as unusable; the API above is the source.

## Risks

- Undocumented API: may change or add auth/Origin checks; response shapes are JSON:API-like but not guaranteed.
- No venue/date/performer in public data; notification can only say title + round + entry period. Keyword matching only on booth/tour title (artist names for idol franchises, not bands like ヨルシカ in general).
- The 1 MB receptions payload: prefer `/booths` for discovery, then diff `entry_opening_receptions_count`/`recent_reception_entry_period_starts_at`, and fetch `receptions?booth_slug=` only for changed booths.
- Not determined: rate limits, whether the API ever requires an Origin header (worked without), header `x-app-version` requirement (worked without).
