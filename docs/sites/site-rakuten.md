# Study: 楽天チケット (ticket.rakuten.co.jp) — keyword search for a MV3 extension

Probed 2026-11-17 with plain curl (Chrome 141 desktop UA), ~35 requests, no login.

## 1. API / feeds

- Rakuten Web Service (webservice.rakuten.co.jp): could NOT be verified; every URL on that host returned HTTP 503 (1.9 KB error page) during probing, so I could not read the API list. From general knowledge the RWS catalogue (Ichiba, Books, Travel, Kobo, GORA, Recipe, Product...) has no ticket/event API. Treat as "no" but unconfirmed.
- No JSON search endpoint found. The site is WordPress (theme hammer-ct-child, assets on tsrar.azureedge.net); search is server-rendered. No `__NEXT_DATA__`, no JSON-LD on search/event pages.
- `https://ticket.rakuten.co.jp/feed/` is linked in `<head>` but returns `content-type: image/png` (broken, not a feed). `/sitemap.xml` is a Google-sitemap-generator index (sitemap-misc.xml, area-sitemap.xml, ...), only useful for discovering events slowly; not examined further.

## 2. Recommended request

```
curl -sS -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' \
  -G 'https://ticket.rakuten.co.jp/' --data-urlencode 's=' --data-urlencode 'q=花譜'
```

- The site's own form (`form[name=cmsseachfrm]`) sends `?s=<empty>&q=<keyword>`. **Use `q`, with `s=` present but empty.** `?s=<keyword>` alone returns 200 but always zero results (body class `search-no-results`, page title `フリーワード: ` blank); `?q=` alone returns the home page.
- Encoding: UTF-8 percent-encoding. Page title echoes the keyword (`フリーワード: Ado`).
- Pagination: `&page=2` (links in `.navigation.pagination .nav-links a.page-numbers` look like `/?s&q=…&page=2`). 20 items per page (verified with q=公演: `全 40件中 1〜20件を表示中`). Page 2 request not executed; the link format is taken from page 1's markup.
- Sort: no sort parameter found; order is not by date (observed unordered by date and mixed). Dedupe by URL.
- Optional `&tpl-style=grid` switches the template (not needed).
- Gotcha: body class always contains `search-no-results` (it is a stale taxonomy class); do NOT use it. Use the count text instead.
- Scope: search is a title/keyword match on the site's own WordPress posts; hits are sparse. 2026-11-17 results: ヨルシカ 0, BUMP OF CHICKEN 0, back number 0, あいみょん 0, Mrs. GREEN APPLE 0, SEKAI NO OWARI 0, ゆず 0, 花譜 1, Ado 1, ライブ 11, 公演 40. Rakuten lists far fewer major-artist tours than Pia/e+; per-artist coverage cannot be relied on.

## 3. HTML vs JS

Server-rendered HTML (about 80-140 KB). No JS needed; DOMParser is enough.

## 4. Bot protection / limits

- 200 on all requests; no Cloudflare/Akamai challenge; AWS ALB cookies (`AWSALB`, `AWSALBCORS`) are set but not required. `cache-control: max-age=30`. nginx. No rate-limit headers; I used ~1 request / 1.5 s.
- robots.txt: `User-agent: *` with no Disallow lines (everything allowed), `Sitemap: http://ticket.rakuten.co.jp/sitemap.xml`.

## 5. Result item fields

Each item is `div.list-tpl-item-wrapper` (desktop) with a duplicate `div.list-tpl-item-wrapper-mobile`; **parse only the `-wrapper` (non-mobile) ones or dedupe by URL**.

| Field                                                       | Selector                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Result count                                                | `.search-query-data .page-count` text `全 N件中 a〜b件を表示中 :` (regex `全\s*(\d+)件中`); keyword echo `.search-query-keywords b` |
| Title                                                       | `.list-tpl-item-wrapper .list-tpl-title h2 a` (text, trim; contains trailing `<i>`)                                                 |
| Detail URL                                                  | same `a[href]` e.g. `https://ticket.rakuten.co.jp/music/rttisja/`, `.../event/rt90pl7/`, `.../mini/events/YX144Pbph`                |
| Stable ID                                                   | last path segment of the URL (`rttisja`, `rt90pl7`, `YX144Pbph`)                                                                    |
| Date(s)                                                     | `.list-tpl-cst-fld-sec-1` text: `2026/12/13(日) 〜 2026/12/13 (日)` or a single date `2026/09/06(日)`                               |
| Venue                                                       | `.list-tpl-cst-fld-sec-2` text (e.g. `パシフィコ横浜`)                                                                              |
| Prefecture                                                  | not present in the list; only in the area taxonomy / detail page                                                                    |
| Sale type                                                   | `.list-tpl-cst-fld-inline-2 label` (`一般発売`; `先行抽選` also observed, via `div.brown-div` vs `div.blue-div`)                    |
| Sale period                                                 | `.list-tpl-cst-fld-inline-3` text `2026/10/16(金) 10:00 〜 2027/01/15 (金) 23:59` (end may be missing)                              |
| Performer                                                   | only inside the title (no separate field); the title may carry prefixes like `【外部サイト】`                                       |
| No-results: count `全 0件` and no `.list-tpl-item-wrapper`. |

Parsed samples:

1. 花譜: `【外部サイト】KAMITSUBAKI WARS 2026 神椿横浜戦線 at パシフィコ横浜 DAY-2　花譜 5th ONE-MAN LIVE「宿声 / 深愛（巡）」※楽天ポイントは貯まりません`, 2026/09/06(日), パシフィコ横浜, 一般発売 2025/01/01 12:00 〜 2026/12/31 23:59, url `https://ticket.rakuten.co.jp/music/rttisja/`, id `rttisja`
2. ライブ: `「@JAM PARTY vol.127」`, 2026/12/13(日), 横浜みなとみらいブロンテ, no sale info, id `rtzpptq` (path `/music/jpop/idle/rtzpptq/`)
3. ライブ: `仮面ライダースーパーライブ2027　大宮公演`, 2027/01/16(土), 大宮ソニックシティ 大ホール, 一般発売 2026/10/16 10:00 〜 2027/01/15 23:59, id `rtza116`
   Note the 花譜 hit is a past event (2026/09/06) still returned; filter by date.

## 6. Per-artist pages

None found. Genre pages exist (e.g. `/music/jpop/jrock/…`, `/music/jpop/idle/…`) and event pages have per-event IDs, but there is no artist entity page. Not checked: whether event pages carry structured data (no JSON-LD found on `/music/rttisja/`).

## 7. Risks

- Very sparse coverage of mainstream J-rock/J-pop artists; many keywords return 0, so this site yields few alerts.
- Search param quirk (`s=` empty + `q=`) is easy to get wrong; a misconfigured request silently returns "no results" (200).
- Unordered results, no sort; need dedupe by URL id and date filtering.
- Mobile/desktop duplicate blocks double-count items.
- RWS availability/ticket API not verified (503).
- Fixtures (all ~80-140 KB): rakuten-kafu.html (1 hit), rakuten-ado.html (1), rakuten-yorushika.html / rakuten-back-number.html / rakuten-bump-of-chicken.html (0 hits), rakuten-koen-paging.html (40 hits, 2 pages).
