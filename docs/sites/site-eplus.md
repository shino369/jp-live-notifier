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
