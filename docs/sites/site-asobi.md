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

## Terms (https://shop.asobistore.jp/guide/rule, fetched 2026-11-19)

Governing text: 「アソビストア会員利用規約」 (Bandai Namco Entertainment Inc.), linked as ご利用規約 from the footer of https://asobiticket2.asobistore.jp/. No separate terms page was found on the ASOBI TICKET site itself; its FAQ is at https://faq.asobiticket2.asobistore.jp/hc/ja. The terms are written for 「アソビストア会員」 (members) and the 本サイト アソビストア, so whether they bind a non-logged-in visitor of ASOBI TICKET is not stated in the text; they are quoted as the only governing document found. robots.txt for asobiticket2.asobistore.jp returns the app's HTML (no robots file) and the booth API (https://asobi-ticket.api.app.t-riple.com/robots.txt) returns 404; shop.asobistore.jp has a robots.txt that does not cover these hosts. No API terms were found.

- 冒頭: 「株式会社バンダイナムコエンターテインメント（以下「当社」といいます）が運営するウェブサイト「アソビストア」（以下「本サイト」といいます）において日本国内向けに提供される個々のサービス（以下「本サービス」といいます）のご利用にあたっては、当社が定める以下の規定が適用されます。」 — Terms apply to services offered on アソビストア in Japan.
- ■本規約の適用について 1: 「本サービスに固有の規程、本サイト中の取り決め、取引条件の表示、利用上の注意等（以下、「個別規程」といいます。）は、本規約を補足し、または本規約の一部を構成します。」 — Service-specific rules and usage notes are part of the terms.
- ■権利帰属について: 「本サービス（それらに含まれる発明、考案、意匠、商標、標章、画像、映像、文章、プログラムその他の一切の情報等を含みます。）にかかる知的財産権その他の一切の権利は、当社または当社がその利用の許諾を得ている第三者に帰属します。」 — IP in the service, including images, video and text, belongs to Bandai Namco or licensors; no reproduction clause is stated.
- ■禁止事項について 1 (1): 「法令違反行為（公序良俗に反する行為、知的財産権の侵害行為、名誉棄損行為、不正アクセス行為、コンピュータ・ウイルスの作成・提供行為等）」 — Members may not infringe IP or make 不正アクセス.
- ■禁止事項について 1 (3): 「本サービスの円滑な提供を妨害する行為（他のお客様による本サービスの利用の妨害、当社または第三者に対する法的な責任を超えた不当な問い合わせ等）」 — No acts that obstruct smooth provision of the service.
- ■禁止事項について 1 (4): 「本サービスを営利目的で利用する行為（本サービスを通じて購入した商品・サービスの第三者への転売等）」 — No commercial use of the service.
- ■禁止事項について 1 (7): 「その他当社が不適切と判断する行為」 — Catch-all; 1 also says 「当該行為に該当するか否かは当社の判断によります」 (Bandai Namco decides what counts).
- ■禁止事項について 2: 「当社がアソビストア会員の禁止行為を確認した場合、当社は以下に定める措置を講じることができます。」 — Measures: downgrade 「プレミアム会員から一般会員への資格変更」, 「本サービスの一時的な利用停止」, 「本規約の解除」.
- Not mentioned: bots, automated access, crawling, scraping, 機械的・自動的な手段, request rate or 過度な負荷, copying or reproducing images, browser extensions or tools, and use of the booth API. The terms contain no 著作権-specific reproduction clause beyond ■権利帰属について.
- Verdict: silent on it. The text has no automated-access, scraping or load clause; the closest are 禁止事項 (3) (obstructing smooth service), (1) (不正アクセス, IP infringement) and the catch-all (7), all of which depend on Bandai Namco's own judgment. Periodic requests (1) to the booth API, the listing display (3), the poster display and downscaled local copy (4) and the background tab (5) are not addressed by name; 権利帰属 states ownership of images but sets no rule on reuse. The terms address 会員 (logged-in members), and the extension uses no login, which the text does not resolve either way. Whether the lack of an express ban is enough, and whether the images' reuse needs separate permission, is the owner's decision. This is what the text says and is not legal advice.
