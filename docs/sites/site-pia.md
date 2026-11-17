# Study: チケットぴあ (t.pia.jp) — keyword search for a MV3 extension

Probed 2026-11-17 with plain curl (Chrome 141 desktop UA), ~25 requests total, no login.

## 1. API / feeds

- No documented public API, no RSS/Atom, `https://t.pia.jp/sitemap.xml` -> 302 (not followed). The footer only offers affiliate sign-up (`/info/affiliates.html`); no partner API discovered.
- Undocumented XHR used by the site's own search page (found in the `<input name="ajaxpath" value="/pia/rlsInfo.do">` hidden field and `rs_search.js`): `GET /pia/rlsInfo.do` returns an **HTML fragment** (not JSON) with the result list. No JSON endpoint was found for search.
- Artist page XHR: `GET /pia/artist/rlsInfo.do?apiRequest=<urlencoded {functions:[{"functionId":"SA403001","parameters":{...}}]}>` (also HTML fragment).
- `https://t.pia.jp/pia/search_all.do?kw=...` (the user-facing page) is a shell; the results div `#rls_info_search_all` is empty in server HTML and filled by JS from `rlsInfo.do`. So the page itself needs JS, the XHR endpoint does not.

## 2. Recommended request (keyword search)

```
curl -sS -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' \
  -G 'https://t.pia.jp/pia/rlsInfo.do' --data-urlencode 'kw=ヨルシカ' \
  -d 'cAsgnFlg=false&bAsgnFlg=false&includeSaleEnd=false&page=1&responsive=true&noConvert=true&searchMode=1&mode=2&dispMode=1'
```

- Parameters are exactly the hidden `<div>`s in `#search_dtl_result_form` on search_all.do (`kw`, `cAsgnFlg`, `bAsgnFlg`, `includeSaleEnd`, `page`, `responsive`, `noConvert`, `searchMode`, `mode`, `dispMode`).
- Encoding: UTF-8 percent-encoding (page is UTF-8; `encodeURIComponent` in the site's JS). Works with no cookies and no Referer.
- Pagination: `page=N`, 10 items/page. Total in `input[name=ptotalcnt]` (items) and `input[name=ptotal]` (pages). Page 2 verified.
- Sort: no sort parameter found in the site JS. Observed order is by performance date ascending (soonest first), not by "newest listing". Extension must diff by ID instead of relying on order.
- `includeSaleEnd=false` hides ended sales; `true` includes them.
- Noise: matching is fuzzy/tokenised. `kw=ヨルシカ` returned 1 item that is a TK from 凛として時雨 event (not Yorushika); `kw=Ado` returned 73 unrelated items (fullwidth titles such as ｃａｄｏｄｅ). Always post-filter titles client-side after NFKC normalisation (Pia stores titles/venues in fullwidth Latin: `ＴＫ　ｆｒｏｍ　凛として時雨`). ASCII `kw` vs fullwidth text: `BUMP OF CHICKEN`, `ＢＵＭＰ　ＯＦ　ＣＨＩＣＫＥＮ`, `back number`, `花譜`, `米津玄師` all returned 0 on 2026-11-17 (probably genuinely nothing on sale; could not confirm independently).

## 3. HTML vs JS

`rlsInfo.do` response is server-rendered HTML, parseable with DOMParser (no JS execution). Content-Type `text/html;charset=UTF-8`, `cache-control: no-cache`.

## 4. Bot protection / limits

- All requests returned 200 with plain curl; no Cloudflare/Akamai challenge, no required cookies (server sets JSESSIONID etc. but they are not needed). nginx. Not tested: high rate; I made ~1 request/sec. No rate-limit headers seen.
- robots.txt: only `User-agent: Googlebot` stanza (Disallow /rsv/, /prs/, /sp/, /column/, many /feature/ and /interview/ pages). There is no `User-agent: *` rule, and `/pia/rlsInfo.do`, `/pia/search_all.do`, `/pia/artist/` are not disallowed.
- Service workers cannot set the `User-Agent` header (forbidden header); the browser UA is sent, which is fine. Not tested from an extension.

## 5. Result item fields (CSS, within the fragment)

Item container: `section.sales_data` (one per sale/release; a single event can appear more than once with different `rlsCd`).

| Field                                                                                                          | Selector                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event title                                                                                                    | `section.sales_data .sales_data_title a` (text)                                                                                                                  |
| Event URL                                                                                                      | same `a[href]` -> `http://t.pia.jp/pia/event/event.do?eventCd=NNNNNNN` (or `?eventBundleCd=bNNNNNNN` for a bundle/tour)                                          |
| Event code (stable ID)                                                                                         | `input.eventCd[value]` (or `input.eventBundleCd[value]`) inside `.add_alert`; or `eventCd` query param                                                           |
| Sale/ticket URL                                                                                                | `.event_link a[itemprop=url]@href` -> `https://ticket.pia.jp/pia/ticketInformation.do?eventCd=…&rlsCd=001&lotRlsCd=`                                             |
| Sale type + title                                                                                              | `.event_link li.is_title` text, format `<sale type>／<title>` e.g. `一般発売／…` (also 先行/プレリザーブ etc. presumably; only 一般発売 observed)                |
| Start date                                                                                                     | `time[itemprop=startDate]@datetime` (ISO, +09:00), display text `li.is_date .dt` e.g. `2026/12/27(日)`                                                           |
| Venue                                                                                                          | `li.is_place [itemprop=name]` (first span)                                                                                                                       |
| Prefecture                                                                                                     | `li.is_place [itemprop=addressRegion]`                                                                                                                           |
| Sale status                                                                                                    | `li.is_status span.is_red` (販売期間中) / `.is_blue` (予定枚数終了)                                                                                              |
| Sale end                                                                                                       | `li.is_status` text after the span: `～2026/12/22(火) 23:59`                                                                                                     |
| Tags (seat select / pre-sale icon)                                                                             | `li.is_tags img@src` (e.g. `label-seatselect.png`, `label-precede.png` = 先行)                                                                                   |
| Result count                                                                                                   | `input[name=ptotalcnt]@value`; no hits -> `.sales_list_noresult` present                                                                                         |
| Performer                                                                                                      | not a separate field; only in the title. Related artists: on `search_all.do` HTML (server-rendered) `.related_artist_data li a[href*=artistsCd=]` + `figcaption` |
| Stable ID: `eventCd` (7-digit), plus `rlsCd` for the specific release; use `eventCd+rlsCd` or `eventBundleCd`. |

Parsed samples (from pia-yorushika-rlsInfo.html and pia-ado-rlsInfo.html):

1. eventCd=2612086, title `一般発売／ＴＫ　ｆｒｏｍ　凛として時雨`, 2026-12-27, 日本武道館, 東京都, 販売期間中 ～2026/12/22(火) 23:59, url `https://ticket.pia.jp/pia/ticketInformation.do?eventCd=2612086&rlsCd=001&lotRlsCd=`
2. eventCd=2634793, `一般発売／藝大定期邦楽　第９２回`, 2026-11-18, 日本橋公会堂（日本橋劇場）, 東京都, 予定枚数終了 ～2026/11/18 15:00, tag label-seatselect
3. eventCd=2636580, `一般発売／千野哲太芸術の秋ツアー２０２６東京公演`, 2026-11-19, Ｍｕｓｉｃ　Ｒｅｓｔａｕｒａｎｔ　Ｌａ　Ｄｏｎｎａ, 東京都, 販売期間中 ～2026/11/18 23:59

## 6. Per-artist pages

`https://t.pia.jp/pia/artist/artists.do?artistsCd=H4240001` (ヨルシカ). Artist codes come from `search_all.do` `.related_artist_data` (server HTML). Events load by XHR: `GET /pia/artist/rlsInfo.do?apiRequest={functions:[{"functionId":"SA403001","parameters":{"page":"1","artistCd":"H4240001","includeSaleEnd":"false","mode":"2","dispMode":"1","responsive":"true"}}]}` (URL-encode the whole value). Response same `section.sales_list` structure; empty -> `.sales_list_noresult` text `ただいまチケット情報はありません。`. This is more precise than keyword search (ヨルシカ has no tickets now, whereas the keyword search returned an unrelated fuzzy hit). Only the empty case was captured (no artist with live results tested), so item markup in the artist fragment is assumed identical to search but unverified. Note: the JS also sets `includeSaleEnd` to `fuzzy` on the page; I used `false`. Two-step approach for the extension: (1) fetch `search_all.do?kw=` once to resolve `artistsCd` (needs title match on `figcaption`), cache it; (2) poll the artist XHR.

## 7. Risks

- Undocumented, HTML-fragment endpoint; markup (`is_*` classes) may change. Terms of use prohibit unauthorised reproduction of content; polling frequency should be low (hourly or less).
- Fuzzy keyword matching causes false positives; fullwidth text needs NFKC normalisation for matching.
- No "newest first" sort; must dedupe on `eventCd`/`rlsCd`.
- Search page itself (`search_all.do`) is not parseable without JS; use `rlsInfo.do`.
- Pia sale types other than 一般発売 (先行, 抽選) were not seen in captured data.
- Fixtures: pia-yorushika-searchpage.html (76 KB), pia-yorushika-rlsInfo.html (1 hit), pia-ado-rlsInfo.html (73 hits, fuzzy), pia-nohit-rlsInfo.html (0), pia-back-number-rlsInfo.html / pia-bump-of-chicken-rlsInfo.html / pia-kafu-rlsInfo.html (0 hits), pia-yorushika-artistpage.html, pia-yorushika-artist-rlsInfo-empty.html. All well under 1.5 MB.
