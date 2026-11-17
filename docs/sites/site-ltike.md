# Study: ローソンチケット https://l-tike.com/

Date checked: 2026-11-17. Fixtures: `test/fixtures/ltike-*`.

## Verdict

- Public/undocumented JSON API: **none found**. Results are server-rendered HTML on `/search/`. Search results are not in `__NEXT_DATA__` (absent); the only JSON-LD is a generic `WebSite` + `SearchAction` (`target=https://l-tike.com/search/?keyword={search_term_string}`). Per-artist cards embed small JSON (`<script type="application/json" id="artist_info_<code>">{"code","name","urlencodedName"}`).
- **Bot protection: Akamai Bot Manager. This is the main blocker.** Plain `curl` (UA = desktop Chrome 140, with or without full browser headers, HTTP/1.1 or HTTP/2) never got a response: HTTP/2 `INTERNAL_ERROR` (curl 92) or a hang to timeout (curl 28) on `/` and `/robots.txt`. Edge IP is Akamai (23.51.138.146), page loads `/akam/13/...` pixel and a sensor script posting to `/_UvkfzQB9/...` (sets the `_abck` cookie). `www.l-tike.com` does not resolve.
- Real Chrome (headed `agent-browser`) works, but erratically: in a fresh browser launch the **first navigation succeeded, later navigations and in-page `fetch()` in the same session failed** with `net::ERR_HTTP2_PROTOCOL_ERROR` / `Failed to fetch`, and it stayed blocked for a minute or more. Headless Chrome was refused every time. After about 40-90 s idle, a fresh headed launch worked again. I took one page per launch. I do not know whether a real user's Chrome with real cookies/history (the extension case) is throttled, but it is plausible that an extension `fetch` with a warm `_abck` cookie works; this must be tested from the extension itself.
- Because curl failed, **I could not capture the raw server HTML**. The fixtures are the **rendered DOM** (`documentElement.outerHTML`) from Chrome, so they are marked `.rendered-dom.html`. The page runs WOVN (client translation to English): translated nodes become `<!--wovn-src:ORIGINAL JP-->English`, with the Japanese kept in the comment. The raw server HTML very likely has just the Japanese (e.g. `<h3 class="ResultBox__title">ウインズ平阪</h3>` has no comment); I could not confirm. When parsing, read text from the `wovn-src` comment if present, else the text node. Set the fetch's `Accept-Language: ja` and treat the English fallback as unreliable.
- robots.txt (`ltike-robots.txt`, 15 KB): `/search/` is NOT disallowed; `/artist/` is not disallowed. Disallowed include `/async/*`, `/mypage/*`, `/login/*`, `/suggest/*`, `/res/*`, `/order` paths etc. Sitemaps: `https://l-tike.com/sitemap.xml`, `sitemap_mevent.xml`, `sitemap_area.xml`, `sitemap_common.xml`, `sitemap_fc.xml`, `sitemap_feature.xml`, `sitemap_genre.xml` (not opened). No RSS found.

## Request

```sh
# Works in a real browser; curl is blocked by Akamai (see above)
curl -sSL -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' \
  'https://l-tike.com/search/?keyword=%E3%83%A8%E3%83%AB%E3%82%B7%E3%82%AB&sort=2&order=desc'
```

- GET, `keyword` is UTF-8 percent-encoded (page `<meta charset>` UTF-8, `document.characterSet` = UTF-8); spaces as `%20` or `+` both land on the same page (`BUMP OF CHICKEN`).
- Sort (from the site's own `<select>`): `sort=4&order=asc` おすすめ (default), `sort=1&order=asc|desc` 公演日の近い順/遠い順, `sort=2&order=asc|desc` 発売日の近い順/遠い順. For newest listings use **`sort=2&order=desc`** (発売日の遠い順). Verified in the fixture `ltike-live-sort2desc`: first hits are `発売前` (not yet on sale), which is consistent with newest-sale-first, though the sort order itself was not strictly validated.
- Pagination: header says `562件中 1~50件を表示` / `(73ページ中)`; the pager is `.Pagination__trigger[data-pagenum]` driven by JS (`a href=""`), and `t_h_jsmodel.js` slices the page client-side (`pageDivs`/`setPage`), so the page appears to include more than the visible page; the saved DOM had 18 `.ResultBox` for a "50 shown" page, so I could not tell the real server-side page size. Not determined.
- Result count: `p.ResultSearchNumber .text_hitcount` (also `.text_prfcount_all`). Zero hits: `.ResultBox` absent and text `条件に一致するチケットは見つかりませんでした。` (artist tab: `条件に一致するアーティストは見つかりませんでした。`).

## Per-item fields (CSS selectors, relative to each `.ResultBox.prfSummaryItem`)

| Field               | Selector / source                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title               | `h3.ResultBox__title` (JP in `<!--wovn-src:...-->` if translated; full-width chars e.g. `ＴＫ　ｆｒｏｍ　凛として時雨`, apply NFKC)                                                                                                                                                           |
| genre               | `.ResultBox__type .category` (`コンサート`...)                                                                                                                                                                                                                                                |
| performer           | not separate; only in the title (and artist tab, see below)                                                                                                                                                                                                                                   |
| date(s)             | `.ResultBox__information` whose `dt.ResultBox__informationTitle` = `公演日：` -> `dt.ResultBox__informationText` e.g. `2026/12/27(日)` or `2027/4/7(水) ～ 2027/4/8(木)`; machine-readable: `#itemInfos .itemInfo[data-prfdate=YYYYMMDD][data-curtaintime=HHMM]` (parallel to boxes by order) |
| venue (+prefecture) | `会場：` -> `dt.ResultBox__informationText` e.g. `日本武道館（東京都）`; `.itemInfo[data-basevenuename][data-prefcd][data-prefname]`                                                                                                                                                          |
| sale type           | `.ResultBox__label #reception_typename` (`先着`, `抽選`) + `p.ResultBox__text #sale_name` (`一般発売`, `プレリク`, ...); `.salesInfo[data-receptiontypename]`                                                                                                                                 |
| sale status         | `p.ResultBox__status` (`発売中`, `発売前`, `受付中`); `.salesInfo[data-salesstatus][data-salesstatusview]`                                                                                                                                                                                    |
| sale period         | `p.ResultBox__date#receiptDat` e.g. `2026/10/10(土) 10:00 ～ 2026/12/21(月) 22:00`; `.salesInfo[data-recpdatestart="20261010 1000"][data-recpdateend="20261221 2200"]`                                                                                                                        |
| ticket URL          | **no href**: button `a.entryBtn[href="javascript:void(0)"]` with `data-lcode`, `data-pfkeys`, `data-schduleno`, `data-basevenuecd`, `data-prfdate`. The target URL is built in JS (not determined; do not click, it starts an order flow).                                                    |
| stable ID           | `a.entryBtn[data-lcode]` (Lコード, e.g. `75161`) = event; `data-pfkeys` (e.g. `20251217000002105391`) = per-performance key; combine `lcode+prfdate+basevenuecd`                                                                                                                              |

Multiple sales for one event produce multiple `.prfItem` blocks inside one `.ResultBox` (`data-prfidx`, `data-salesidx`). `.ResultBox` with `data-currentdataflg="0"`.

Artist tab (same page, `#artist`): `.ResultBlock__title a.ResultBlock__link[href="/artist/<code>/"]` plus `script#artist_info_<code>` JSON -> artist codes: ヨルシカ `000000000719249`, BUMP OF CHICKEN `000000000132941`, 花譜 `000000000876487`.

## Parsed samples (`ltike-yorushika.rendered-dom.html`, 1 hit)

```
title: ＴＫ　ｆｒｏｍ　凛として時雨 | genre コンサート | 公演日 2026/12/27(日) | 会場 日本武道館（東京都）
sale: 一般発売 / 先着 / 発売中 / 2026/10/10(土) 10:00 ～ 2026/12/21(月) 22:00
lcode 75161 | pfkeys 20251217000002105391 | basevenuecd 36901
```

(`live` keyword, `ltike-live-sort2desc`): `ウインズ平阪 | 2027/7/18(日) | ＲＯＣＫＴＯＷＮ（大阪府） | 先着 一般発売 発売前 | lcode 52846`; `井上芳雄 | 2027/4/7(水) ～ 2027/4/8(木) | ＴＯＹＯＴＡ ＡＲＥＮＡ ＴＯＫＹＯ（東京都）`.

Fixture results: ヨルシカ 1 hit (a TK from 凛として時雨 show; the artist ヨルシカ is itself found in the artist tab); BUMP OF CHICKEN: **0 tickets** (the artist tab lists 3 artists: BUMP OF CHICKEN, チームラボ, 直井由文); 花譜: 0 tickets; nonsense keyword: 0 tickets and 0 artists. The BUMP/花譜 zero-hit pages are real "no tickets" states, but they could also be a bot-degraded response; e+ shows 12 BUMP performances right now, so l-tike could genuinely not sell them.

## Per-artist pages

`https://l-tike.com/artist/<code>/` (fixture `ltike-artist-bump-000000000132941.rendered-dom.html`, 134 KB) loads and renders; for BUMP it shows `現在受け付け中のBUMP OF CHICKEN（バンプオブチキン）のチケットはございません。` (no tickets). I could not inspect a populated artist page, so its item markup is unknown. Artist codes come from the search page's artist tab; this is a more precise way to monitor (look up code once, then poll `/artist/<code>/`), but that structure is unverified.

## Risks

- Akamai Bot Manager: curl impossible; headless browser blocked; even headed Chrome is intermittently reset after the first request. A service-worker `fetch` has a Chrome TLS stack but no `_abck` sensor cookie unless the user has visited the site. Strong recommendation: validate from the actual extension, with `credentials: 'include'`, and throttle hard (one request per many seconds, and fall back to opening a tab/offscreen document).
- Raw HTML never captured; fixtures are post-JS DOM with WOVN comments; selectors above are valid for the rendered DOM and probably for server HTML minus the `wovn-src` comments.
- No detail URL in the markup (JS button), so notifications would link to the search/artist URL.
- Pagination (client-side, 50 per page, 562 hits for a broad term) not fully understood.
- `back number` was not tested.
