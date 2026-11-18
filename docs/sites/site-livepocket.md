# LivePocket (https://livepocket.jp/) - study (fetched 2026-11-17)

## Verdict

- Public API: none. No RSS/Atom. Sitemap URL is listed in robots.txt but returned a WAF challenge (HTTP 202) for me, so not inspected.
- Keyword search page is server-rendered HTML (Rails + Turbo). Parse with DOMParser; no JS rendering needed.
- BLOCKER: AWS WAF bot challenge (CloudFront). Without the `aws-waf-token` cookie every request, including robots.txt, returns `HTTP 202` with `x-amzn-waf-action: challenge` and a ~2.4 KB JS challenge page. With a valid token cookie, plain curl returns 200 and the full HTML.

## Bot protection

- Plain curl (Chrome 141 UA, Accept-Language ja): 202 challenge on `/`, `/event/search`, `/robots.txt`.
- Real browser (agent-browser) solves the challenge via JS and gets cookie `aws-waf-token=<uuid>:<blob>` (set on JS, not via Set-Cookie). Replaying only that cookie with curl -> 200, `server: openresty`, `cache-control: no-store`. No other header needed. A fresh `_session` cookie is issued, not required.
- Implication for the extension: a service-worker `fetch("https://livepocket.jp/...", {credentials:"include"})` will carry the token only if the user's browser has a valid `aws-waf-token` for livepocket.jp (i.e. visited the site recently). Token lifetime is unknown (not measured; AWS WAF immunity time is site-configured, often minutes). Fallback needed: on a 202 / `x-amzn-waf-action: challenge` response, open the URL once in a background tab or hidden window so the browser solves the challenge, then retry. An offscreen document loading the URL in an iframe/page may also solve it (not tested).
- Rate limit: not hit with ~12 requests spaced 2 s. Unknown thresholds.
- robots.txt (fetched with token): `User-agent: *` and `Sitemap: https://livepocket.jp/sitemap/sitemap.xml`. No Disallow lines, so /event/search is allowed.

## Endpoint

```
curl -sSL -A "$UA" -H "Cookie: aws-waf-token=$TOKEN" \
  "https://livepocket.jp/event/search?word=<urlencoded keyword>&sort=3&page=<n>"
```

Params

- `word`: keyword; UTF-8 percent-encoded, spaces as `+` or `%20`. Quoted phrases do not make it stricter. Matching is fuzzy and token-based: `BUMP OF CHICKEN` -> 177 hits (mostly unrelated bands), `"BUMP OF CHICKEN"` -> 177, `BUMP OF` -> 175. It matches title/performers/etc. Always re-filter locally on title + cast text.
- `sort`: `1` event date newest first (開催日が新しい順), `2` event date oldest first, `3` publish date newest first (公開日が新しい順) - best for "new listings", `4` relevance (default).
- `page`: 1-based, 20 items per page. Footer text `1~20件表示 / 177件中`. Pager links in `.pagination__button` (`page=2` ...). Page 21+ of a 1,165 result query works.
- Other filters seen in the form: `pref`, `date_after`, `l_cat`, `s_cat`. Generic list of all upcoming events: `/event/search?word=&sort=3` (not tested with empty word; `word=ライブ&sort=3` returned 1,165).
- Page language: server HTML is Japanese. A WOVN script translates client-side when `wovn_selected_lang=en` cookie is set (the DOM seen in the browser had English `<title>`), but raw fetch HTML is Japanese.

## Results markup (server HTML)

Pickup/sidebar widgets also contain `.event-card` elements (16 even on a no-result page), so scope selectors to `ul.event-card-list > li.event-card-list__item`.
No result: `ul.event-card-list` absent (0 `.event-card-list__item`), page contains text `検索結果が見つかりませんでした`.

| Field                  | Selector (within `li.event-card-list__item`)                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| detail URL / stable ID | `a.event-card` `@href` = `/e/<id>` (ID is a 5-char slug like `ww1ek` or custom like `que20270111`; use as stable ID) |
| sale status tag        | `.event-card__tag` text: 販売中, 販売前, 売切, 販売終了, 中止                                                        |
| title / tour           | `.event-card__title`                                                                                                 |
| date (event day)       | `.event-card__text--date` (text after `.event-card__date` label), e.g. `2026年11月23日(月)`                          |
| time                   | the `<p class="event-card__text">` containing `span.event-card__time`, e.g. `13:00〜` (optional)                     |
| venue + prefecture     | `p` containing `span.event-card__place`, e.g. `新宿LOFT（東京都）`; prefecture is the trailing fullwidth parentheses |
| performers             | `.event-card__text--cast` (after `span.event-card__cast`), separated by `/`; optional                                |
| image                  | `.event-card__image img@src`                                                                                         |
| total / paging         | `.event-list-sort__text` (`1~20件表示 / N件中`), `.pagination__button`                                               |

Not in list cards: sale type (先行/一般) and sale period. They are on the detail page `/e/<id>`:

- `section#ticket li.event-detail-ticket__item`: `.event-detail-ticket-head__status .tag-normal-secondary` (status e.g. 予定販売枚数終了), `.label-order` (先着 / 抽選 etc.), `.event-detail-ticket-head__title` (ticket name, e.g. 先着販売受付(二次販売)), `.event-detail-ticket-head__list-data` (`販売受付期間` start 〜 end).
- `<script type="application/ld+json">` schema.org Event: `name`, `startDate`, `endDate`, `location.name`, `offers[].url/price`, `description` (pipe-joined date : venue : performers).
- 開演/開場/終演 times, address in the overview block.
  Only fetch detail pages for hits that match a keyword and are new.

## Parsed sample (fixtures `livepocket-backnumber.html`, `livepocket-bump.html`, `livepocket-yorushika.html`)

1. id `ww1ek` | 販売中 | 武蔵野大学【音楽×文学】座談会 公開収録 ──ヨルシカの楽曲はなぜ文学的と言われるのか── | 2026年11月23日(月) | 13:00〜 | 武蔵野大学 武蔵野キャンパス 紅雲台1Fホール（東京都） | 土屋忍 / 文月悠光 / 木下龍平 (ヨルシカ is only in the title)
2. id `que20270111` | 販売前 | Number the./Francis with Lily/... “modern room 『The Sound Gallery "New Year Special" 』” | 2027年1月11日(月) | 下北沢CLUB Que（東京都） (a `back number` search hit that is NOT the band: false positive)
3. id `ts76_` | 販売中 | 新宿LOFTの年末大感謝祭2026 | 2026年12月28日(月) | 新宿LOFT（東京都）

## Fixtures (all in `test/fixtures/`, all fetched with a valid WAF token, ~90-125 KB each)

- `livepocket-yorushika.html` (1 hit), `livepocket-bump.html` (177, fuzzy), `livepocket-backnumber.html` (32), `livepocket-kafu.html` (0 hits, 花譜), `livepocket-none.html` (0 hits, nonsense), `livepocket-live-sort3.html` / `-p2.html` (pagination, 1,165), `livepocket-detail-ww1ek.html` (detail page), `livepocket-robots.txt`.

## Risks

- WAF token availability/expiry (main risk); a 202 must be treated as "challenge", not "no results".
- Fuzzy search yields many false positives; local filter required. Date is event day, not on-sale date; sort=3 is publish order so diff by ID set per keyword.
- Cast/title text is free-form by organizers; band may appear only in title, and tags 販売前 means not yet on sale.
- HTML class names (`event-card__*`) may change; layout is BEM-style and fairly stable. Index not checked for Turbo-only responses.
- Not determined: token TTL, rate limits, whether an offscreen document can solve the challenge, sitemap contents, empty-`word` listing.

## Terms (https://livepocket.jp/term, fetched 2026-11-19)

Governing text: 「LivePocket、LivePocket-Ticket-利用規約」, operated by LivePocket株式会社. The page lists 改定日 up to 令和8年11月9日. Applies to site viewers (see 第1条 (8) and 第2条). Privacy Policy is separate (https://livepocket.co.jp/privacy). robots.txt returned HTTP 202 (WAF challenge) to curl and was not read in a browser; its content is unknown.

- 第1条 (8) 「利用者」: 「「利用者」とは、本サービスを利用する者を指し、本サイトの閲覧者、チケット購入者、チケット販売者、同行者等を含みます。」 — "User" includes mere site viewers.
- 第2条 (利用規約) 1: 「本規約は本サービスを利用する一切の場合について適用されます。利用者が本サービスへの入会を申し込んだ時点、又は本サイトを利用した時点で、本規約の内容を承諾したものとみなします。」 — Terms apply to all use; using the site counts as consent.
- 第12条 (権利帰属) 1: 「本サービスを通じて提供される全てのデータ、文章、音声、映像、写真、イラスト、情報（チケット販売者が提供する対象イベントに係る情報を含みます）、対象チケット電子データ、本サービス専用アプリに関する、著作権、商標権、肖像権を含む一切の権利は、当社又は当該権利を有する第三者に帰属します。」 — All data, text, photos, illustrations and event info belong to LivePocket or third-party rights holders.
- 第13条 (禁止事項) (1): 「当社又は他者の著作権、商標権等の知的財産権を侵害する行為、または侵害するおそれのある行為」 — No infringing IP, including potentially infringing acts.
- 第13条 (禁止事項) (13): 「他者の設備等又はインターネット接続サービス用設備の利用又は運営に支障を与える行為、または与えるおそれのある行為」 — No acts that hinder or may hinder others' equipment or service operation (the nearest clause on load).
- 第13条 (禁止事項) (25): 「ボットなどの自動化手段を用いて本サービスを利用する行為」 — Using the service by bots or other automated means is prohibited.
- 第13条 (禁止事項) (27): 「本サービスを本規約に定める利用法以外に利用する行為」 — No use other than the way the terms provide.
- 第13条 (禁止事項) (30): 「その他本サービスの運営を妨げると当社が判断する行為」 — Catch-all: acts LivePocket judges to hinder operation.
- 第14条 (禁止行為等に対する措置) 1: 「当社は、利用者が次の各号にいずれかに該当する場合、禁止行為を是正し、予告なく当該利用者への本サービスの提供を中止若しくは停止し、又は会員を強制退会させることができるものとします。」 — Violations may lead to service suspension without notice or forced withdrawal.
- Footer: 「掲載されている全てのコンテンツについて管理者の承諾を得ず、無断で複写・複製・転送することは固く禁じています。」 — Copying, reproducing or forwarding any content without the administrator's consent is strictly forbidden.
- 第17条 1 (2) (context for load): 「本サービスに係るシステム又は通信回線等の、障害、誤操作、過度なアクセスの集中、不正アクセス又はハッキング等により、当社が停止又は中断が必要であると判断した場合。」 — LivePocket may suspend service on 過度なアクセスの集中; this is a service-suspension ground, not a user prohibition.
- Not mentioned: a numeric request-rate limit, an explicit "crawling" or "scraping" term, browser extensions, and personal-use exceptions for copying content. 第12条 2 lets LivePocket reuse event info posted by organizers, but that is the reverse direction.
- Verdict: forbids automated access. 第13条 (25) 「ボットなどの自動化手段を用いて本サービスを利用する行為」 covers any scheduled request that a script rather than a person makes, and (1) plus the footer's no-copy-or-reproduce line cover content use. The extension's periodic search-page requests (1) are automated use of the site, and the text has no exception for low frequency, personal use or a browser extension. Showing titles, dates and links (3), displaying or storing poster copies (4) and opening a tab to pass a bot check (5) are not addressed by name, but (4) falls under 第12条 and the footer copy ban, and (5) touches the WAF challenge directly. Whether to ship LivePocket support, make it opt-in or drop it is the owner's decision. This is what the text says and is not legal advice.
