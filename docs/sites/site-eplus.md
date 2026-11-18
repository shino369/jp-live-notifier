# Study: e+ (イープラス) https://eplus.jp/

Date checked: 2026-11-17. Fixtures: `test/fixtures/eplus-*.html`.

## Verdict

- Public API: **no**. The site's own XHR API (`https://api.eplus.jp/v3/koen/keyword`, `/v3/koen`) exists but returns 401 without an `X-APIToken` header. The token is hard-coded in the site's `property.js`. I did not use it (it is a key not issued to us) and recommend against building on it.
- **Better: the search page embeds the first 20 results as JSON in the server HTML**, in `<script id="json" class="json" type="application/json">`. Plain curl is enough. No JS rendering, no bot challenge.
- **robots.txt disallows `/sf/search`** (also `/sf/word/search`, `/sf/venue/search`, `/sf/updated_events/search`, `/sf/streamingplus/search`, `/sf/*block=true`). The extension is a user-run personal tool, but whether to honor this is the owner's decision. I fetched at about 1 request per 2 s, a few requests in total.
- No RSS/Atom. Sitemaps are listed in robots.txt (`https://eplus.jp/s/eplus.jp/sitemap_daily_kkn.xml`, `sitemap_weekly*.xml`, `sitemap_monthly*.xml`); I did not open them (not useful for keyword search).

## Request

```sh
curl -sSL -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' \
  'https://eplus.jp/sf/search?block=true&keyword=BUMP+OF+CHICKEN'
```

- Method GET, no cookies needed (server sets `visited`, `KOJIN_SHIKIBETSU`, `AWSELB*`; none required).
- The parameter is `keyword` (UTF-8, percent-encoded; `+` or `%20` for spaces). NOT `word`: `word=` returns an empty shell with no results.
- `block=true` is what the site's header form submits.
- Response: `200 text/html;charset=UTF-8`, 100-190 KB, `Server: nginx`, AWS ELB cookies. No Cloudflare/Akamai.
- Sorting: server-fixed `sort_key=koenbi,kaien_time,parent_koen_taisho_flag,kogyo_code,kogyo_sub_code` (performance date ascending). There is no "newest listing" sort. Detect new listings by diffing IDs. `info_kokai_start_datetime` (listing publication time) is available per record as a secondary signal.
- Pagination: HTML holds only the first 20 records (`shutoku_kensu=20`). Total is in `data.so_kensu` (and `input.so_kensu[value]`). "もっと見る" calls the token-protected API with `shutoku_start_ichi`, so pages 2+ are not reachable from plain HTML. For artists with more than 20 upcoming performances, extra results are lost unless the query is narrowed.
- Zero results: still `200`; `<script id="json">` body is blank, and `.block-no-result` shows `該当する公演はありませんでした。`.

## Data location and paths

`JSON.parse(document.querySelector('script#json.json').textContent).data` (in an offscreen document; or regex the raw text if the string is empty guard).

| Field             | JSON path (per `data.record_list[i]`)                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| total hits        | `data.so_kensu`                                                                                                                     |
| event/tour title  | `kanren_kogyo_sub.kogyo_name_1` (+ `kogyo_name_2`)                                                                                  |
| performer(s)      | `kanren_uketsuke_koen_list[].shutsuensha` (free text, may have `&lt;` entities); `kanren_word_list` (null in samples)               |
| venue             | `kanren_venue.venue_name`                                                                                                           |
| prefecture        | `kanren_venue.todofuken_name` (`todofuken_code`)                                                                                    |
| date / time       | `koenbi_term` (`YYYYMMDD`); `kaijo_time` open, `kaien_time` start, `shuen_time` end (`HHMM`)                                        |
| sale type         | `kanren_uketsuke_koen_list[].hambai_hoho_label` (先着/プレオーダー), `uketsuke_name_pc` (e.g. `★一般発売`, `☆ファミリーマート先行`) |
| sale period       | `uketsuke_start_datetime`, `uketsuke_end_datetime` (`YYYYMMDDHHMMSS`)                                                               |
| sale status       | `uketsuke_status` (`0` on sale, `5` ended seen; `1`-`4` meanings unconfirmed)                                                       |
| listing published | `info_kokai_start_datetime` / `info_kokai_end_datetime`                                                                             |
| cancel/postpone   | `abort_henko_enki_status` (`"0"` normal)                                                                                            |
| detail URL        | `https://eplus.jp` + `koen_detail_url_pc` (e.g. `/sf/detail/0025330001-P0030241P021001`)                                            |
| stable ID         | `koen_detail_url_pc` (one per performance). Tour-level: `kogyo_code` (`002533`). Venue: `kanren_venue.venue_code`.                  |

The raw HTML has no static result cards (cards are rendered client-side by Handlebars from that JSON), so there are no CSS selectors for items; use the JSON. Detail pages `/sf/detail/...` also carry `application/ld+json` `Event` (name, startDate, location.name, address.addressRegion).

## Parsed samples

BUMP OF CHICKEN, 12 hits (`eplus-bump-of-chicken.html`):

```
002533 | /sf/detail/0025330001-P0030241P021001 | 20261121 開場1700 開演1800 | あなぶきアリーナ香川 (香川県) | BUMP OF CHICKEN
  sales: ☆イープラス最速プレオーダー プレオーダー 20251226180000-20260104235900 status 5; ☆ファミリーマート先行 20260110-20260118 ...
002533 | /sf/detail/0025330001-P0030246P021002 | 20270207 | 東京ドーム (東京都)
```

ヨルシカ, 1 hit (`eplus-yorushika.html`): `115089 | /sf/detail/1150890001-P0030102P021001 | 20261227 17:00/18:00 | 日本武道館 (東京都) | title "TK from 凛として時雨"`. It matched via `shutsuensha` = "Special Guest: suis from ヨルシカ". `★一般発売` 先着 20261010100000 - 20261226180000, status 0.

花譜: 0 hits (`eplus-kafu.html`). Nonsense keyword: 0 hits (`eplus-noresult.html`).

## Per-artist pages

- Artist directory: `https://eplus.jp/sf/word/search?block=true&keyword=<name>` (robots-disallowed) lists `a.favorite-item__trigger[href="/sf/word/<10-digit id>"]` with `.favorite-item__name`. ヨルシカ = `/sf/word/0000136266`.
- `https://eplus.jp/sf/word/0000136266` (fixture `eplus-word-0000136266.html`) returned 200 but had no embedded event JSON and empty `seemoreuri/seemoreparam`; its events load through the token API. Not usable via plain HTML. Vanity URLs like `/bump/` redirect to `/s/notfound.html`.

## Risks

- robots.txt disallows the search path.
- Only 20 results per query in HTML; no newest sort.
- Keyword match is fuzzy full text (ヨルシカ matched another act's event through a guest credit): filter on title/performer client-side.
- `back number` and other multi-word or common-word names were not tested.
- The embedded-JSON format is internal (site JS dates from 2020-2022, so it has been stable for years, but there is no contract).
- `test/fixtures/eplus-api-direct.json` is the 401 response from the API without a token (evidence only).

## Terms (https://eplus.jp/sf/customer/rule and https://eplus.jp/sf/customer/rule/non-member, fetched 2026-11-19)

e+ publishes two versions: member 利用規約 (第1条 defines お客様 as users of the sales / membership service) and a non-member version (第1条: users of the sales service "会員登録されずに"). Clause numbers below are the member version; the non-member version has the same text as 第7条 (禁止事項) and 第8条 (著作権). Last revision line seen on the page: 2024年2月15日 (in an attached consent clause; no top-level revision date shown).

- 第9条 禁止事項 (非会員版は第7条): 「他のお客様、第三者または弊社の著作権、財産権、プライバシーもしくはその他の権利を侵害する行為、および侵害するおそれのある行為」 — no infringing copyright/property rights of e+ or third parties.
- 第9条 禁止事項: 「弊社の承諾なく、本サービスを通じて、もしくは本サービスに関連して、営利を目的とする行為、またはその準備を目的とした行為」 — no commercial activity or preparation for it without consent.
- 第9条 禁止事項: 「コンピュータウィルス等の有害なプログラムを、本サービスを通じてまたは本サービスに関連して、使用し、もしくは提供する行為」 — no harmful programs (malware).
- 第9条 禁止事項: 「前項の他、他のお客様、第三者または弊社に不利益もしくは損害を与える行為、および与えるおそれのある行為」 and 「その他、弊社が不適切と判断する行為」 — catch-alls (harm to e+, anything e+ judges inappropriate).
- 第10条 著作権 (非会員版は第8条): 「お客様は、権利者の許諾を得ないで、いかなる方法においても、本サービスを通じて提供される情報またはファイルについて、著作権法等で定めるお客様個人の私的利用の範囲を超えて、使用することはできないものといたします。」 — information/files from the service may not be used beyond private use under copyright law without the rights holder's permission.
- チケット購入規定 (the purchase-rules part of the same page, in the clause on cancelling/refusing a purchase; clause number not confirmed): 「他のお客様の迷惑になるような行為または弊社の円滑な販売を妨げるような行為をされた場合」 — obstructing e+'s smooth sales is a ground for e+ to cancel a purchase; it concerns ticket purchasing, not browsing.
- robots.txt (https://eplus.jp/robots.txt): `User-agent: *` with 「Disallow: /sf/search」 (also `/sf/venue/search`, `/sf/word/search`, `/sf/updated_events/search`, `/sf/*block=true`). — the site search results path is disallowed for crawlers. A test request to `/sf/search?block=true&keyword=test` returned HTTP 200, so it is not technically blocked.
- Not mentioned: no clause naming bots / crawlers / scraping / 自動 access / 機械的手段; no server-load or request-frequency clause; no browser-extension or tool clause; no clause on image (poster) reproduction specifically; no API or data-use policy. 利用規約 is addressed to people using the purchase / membership service; it does not separately address plain browsing.
- Verdict: **silent on it** (on the terms; but robots.txt disallows `/sf/search`). No clause covers automated access, load or extensions. The relevant text is 第9条 (commercial use; harming e+; "弊社が不適切と判断する行為"), 第10条 (use of provided info/files beyond private use needs the rights holder's permission) and the robots.txt Disallow on `/sf/search`. Behaviour (1) requests exactly the disallowed search path at low frequency, and (2) fetches one listing page for og:image; (3) shows titles and dates for the user alone. (4) shows poster images, which are copyrighted material of rights holders; whether showing the image URL or keeping a local copy counts as private use is the owner's decision. For e+ the Disallow is the strongest signal and the owner decides whether to honour it. Whether the 第9条 catch-all applies to an extension is the owner's decision; (5) applies to e+ only if the owner uses it (e+ has no bot-check handling described here).

---
