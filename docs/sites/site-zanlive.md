# ZAN-LIVE / Z-aN (https://www.zan-live.com/ja/) - study (fetched 2026-11-18)

## Verdict

- Public API: none found. No RSS/Atom, no sitemap (`/sitemap.xml`, `/ja/sitemap.xml` 404), no robots.txt (404).
- **No keyword search at all.** `/ja/search?keyword=...` and `/ja/event_list/search` 404; the pages have no search form or search script (only `jquery-3.5.1`, `common.js` (23 KB, only calls `/api/supervisor/ticket-groups`), swiper). `/ja/event_list`, `/event_list/new`, `/event_list/archive`, `/live/list?page=2`, `/api/ja/events` all 404. No pagination anywhere. Only `/ja/event_list/recommended` exists as a list page (single page, no pager).
- Pages are server-rendered HTML (nginx, jQuery); parse with DOMParser, no JS rendering needed. Adapter must be "list everything, filter locally" (`filterLocally` default true) over the home page (+ optionally the recommended page).
- Brand spelling: the site calls itself `Z-aN` (title `... - Z-aN`, logo `h1.c-zan-logo`); domain/product is ZAN-LIVE. Use id `zanlive`, name `ZAN-LIVE`.
- Weakness: list cards carry the title only. There is NO performer field in any list; performers are free text on the detail page. So matching is on the title only unless detail pages are fetched (only for new hits).

## Bot protection

- None seen. Plain curl (Chrome 141 UA, `Accept-Language: ja`), no cookies: 200, `server: nginx`, `cache-control: no-store`, no `Set-Cookie`, no challenge. About 14 requests spaced >= 3 s, no rate limiting hit (thresholds unknown). No special headers needed.
- Sizes: home 154 KB, recommended 55 KB, detail ~180 KB. Unknown paths return a 404 HTML page (~30 KB), which the adapter must treat as a failure (status != 200), not "no results".
- Static assets are on `static.zan-live.com`, images on `storage.zan-live.com` (webp).

## Sources (use these)

1. `https://www.zan-live.com/ja/` (primary). 75 unique `/ja/live/detail/<id>` links. Sections (`h2.c-headline`, `c-event-card`):
   - 開催日時が近いイベント: 41 cards, upcoming, ascending by date (2026/11/19 ... 2027/3/28 when fetched). Best "upcoming" source.
   - 新着イベント: 10 newest-published (dates vary). 抽選応募受付中のイベント: 2 (lottery open). ピックアップ: 6 (date div empty). 人気のイベント: 10 (no date element). アーカイブ: 34 past/archive events (dates in the past) - ignore.
   - 13 of the 34 archive ids also appear in the upcoming sections; dedupe by id, then drop events whose date is before now.
2. `https://www.zan-live.com/ja/event_list/recommended` (optional second request). 43 cards (`c-event-list`), includes past events (2025 dates); 32 of the home ids are not in it and it adds some not on the home page. Not date-sorted. No status badges.

Together the two give ~54 upcoming events. The site seems to list only a curated subset, so it can never be exhaustive; an artist not shown there is simply not found.

## Listing markup

Home (`c-event-card`), scope to `div.c-event-card`:

| Field              | Selector / source                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| detail URL / id    | `a@href` = `/ja/live/detail/<numeric id>`; id (e.g. `11031`) is stable                                                                                                    |
| title              | `.c-event-card__title`                                                                                                                                                    |
| date + start       | `.c-event-card__date` text, whitespace padded: `2026/11/19(木) 17:00 ~` (no zero padding: `2027/1/7(木)`). Absent/empty in 人気のイベント and ピックアップ cards          |
| venue vs online    | `.c-event-card__badge.venue` (会場 = offline venue) and/or `.c-event-card__badge.online` (オンライン); both can be present (hybrid). No venue name or prefecture in lists |
| image              | `.c-event-card__thumbnail img@src` (`storage.zan-live.com/image/top/small/...webp`)                                                                                       |
| sale status/ranges | not in lists                                                                                                                                                              |

Recommended page (`c-event-list`): `div.c-event-list > a@href`, title `.c-event-list__title`, date `.c-event-list__date` (`2026/12/29(火) 15:30 ~`, always present), image `.c-event-list__thumbnail img@src` (`.../image/top/medium/...`). No badges.

Only the date is the event start, not a sale date. Cards of ranking/pickup sections without a date should still be kept by id from the other sections; if no date exists anywhere, either fetch the detail page or keep them with an unknown date.

## Detail page `/ja/live/detail/<id>` (not in lists; fetch only for new hits)

No JSON-LD. `og:title`, `<title>` `<name> -  Z-aN`.

- Title `.p-event__event-title`; rows `.p-event__event-info` with label `.p-event__event-info-column`: `開催日` (`2026年11月19日(木) 開演 17:00　(開場 16:30)`), `一般販売` (sale start, `2026年10月20日(火) 21:00〜`; other rows e.g. presale/lottery labels may appear).
- Performers: free text in `.p-eventinfo__detail` (e.g. `出演:Traumagier / クソガキ`), organizer-formatted, not structured.
- Per-date block `table.p-eventinfo__statDateTable` (`.datetime`, `.location` with place name); venue `.p-event-venue h3` + address line (prefecture in the address, e.g. `東京都新宿区...`); ticket filter `button.js-ticket-filter[data-date="202611191630-202611191700"]` (open-close times); area checkbox `ticket-info-onsite-JP-13` label `東京`.
- Purchase requires login (`/ja/auth/login?redirect=<base64 url>`).

## Page-shape markers (for `expect`)

There is no "no results" state; the home page always has cards. Suggested `expect`:
`/c-event-card__title|c-event-list__title/` (a 404 or error page has neither). Also check HTTP 200 (404 page is ~30 KB HTML, still has the site chrome).

## Terms (/ja/info/terms.html, 利用規約) - RISK

Article 6 (禁止事項) lists, for 会員 (members): (17) `本サービスに対して、当社提供のインターフェース以外での方法でアクセスする行為` and (18) `ボットなどの自動化手段を用いて本サービスを利用する行為`, plus (16) `本サービスのサーバーやシステムに対して過度な負担をかける行為`, and a ban on decompiling/reverse engineering. The clause is addressed to members and we read public, logged-out pages, but an automated fetch could still be read as breaching (17)/(18). Keep it to 1-2 requests per run on a long interval, no login, and flag this to the user.

## Fixtures (`test/fixtures/`)

- `zanlive-home.html` (154 KB, home page, unmodified; no CSRF/session tokens present, no cookies set).
- `zanlive-recommended.html` (55 KB, `/ja/event_list/recommended`).
- No no-results fixture (no search exists). Fixtures were fetched 2026-11-18, so "upcoming" dates drift; tests must inject `now`.

## Parsed sample (home, 開催日時が近いイベント)

1. id `11031` | 言霊生誕祭 | 2026/11/19(木) 17:00 | 会場
2. id `11046` | 緋翠リコ 現地定期ライブ | 2026/11/19(木) 19:00 | 会場 + オンライン
3. id `11003` | 舞台『大正浪漫探偵譚 -エデンの歌姫-』展示会 | 2026/11/20(金) 12:00 | 会場

## Risks / uncertain

- Small curated catalog (~54 upcoming); many artists will never appear. Title-only matching (performers only on detail pages) lowers recall; consider fetching detail pages of upcoming events lazily for 出演 text (costly, more terms exposure).
- Cap of 41 on 開催日時が近いイベント unknown (maybe a fixed limit); the recommended list may be hand-curated.
- Selectors are BEM-like (`c-event-card__*`) and could change; two card variants (`c-event-card`, `c-event-list`).
- Not determined: rate-limit thresholds, whether the channel pages (`/ja/channel/<slug>`, 21 cards on `shuffle`, same `c-event-card` markup) are worth fetching per artist (they are artist/organizer-specific and could be a cheap per-artist source if a keyword maps to a slug; not tested for completeness).
