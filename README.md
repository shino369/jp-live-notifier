# JP Live Notifier (Chrome extension, MV3)

Notifies you when new live/concert listings appear for your artists on e+, ローチケ, チケットぴあ,
楽天チケット, LivePocket, and ASOBI TICKET. No server: everything runs in your browser.

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the
   [`extension/`](extension/) folder of this repository (not the repository root: Chrome refuses
   folders with `node_modules`). After pulling changes, click ↻ on the extension's card.
2. The settings page opens. Add artists one per row (pasting several lines adds them all).
3. The first check runs at once. What is already on sale goes into the inbox **unread**, with one
   "Now watching" summary instead of a notification each, so adding an artist does not flood you.
   Later finds notify you one by one.

## Use

- **Toolbar popup:** the latest notifications. The badge counts unread ones. Click an item to open
  it in the inbox.
- **Inbox** (email-style, list + detail): artist, title, date/time, venue, prefecture, and one row
  per ticket site/sale with a link. ☆ saves an item; starred items are never cleared or deleted.
  🗑 deletes one item; the "clear" button removes every read, unstarred item. A deleted show does
  not come back, even when another site lists it later. Keys: `j`/`k` or ↑/↓ to move, `s` to star.
- **System notifications:** clicking one opens its detail. More than 3 at once arrive as one
  summary.

## How it works

```text
chrome.alarms (every 30 min – 12 h, default 1 h)
  → queue of (artist × site) jobs, at most one request per site, ≥3 s apart
  → fetch from the service worker (host_permissions: no CORS, your site cookies are sent)
  → parse: JSON directly; HTML in an offscreen document (service workers have no DOMParser)
  → keep upcoming listings whose title/performers contain the artist (NFKC, case, kana folded)
  → group: same show = overlapping dates + similar venue (or title) → one notification, one
    offer row per site
  → seen index (site:id) decides what is new; deleted shows leave a tombstone
  → notification + badge
```

| Site         | Source                                            | Notes                                                                                                                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| e+           | `/sf/search` HTML with embedded JSON (first 20)   | No bot shield. robots.txt disallows this path for crawlers; the extension asks for you at a low rate, and you can turn it off. |
| ローチケ     | `/search/` HTML, newest sale first                | Akamai Bot Manager: works from a normal (headed) Chrome; blocked in headless. Ticket link is the `gLcode` order page.          |
| チケットぴあ | `rlsInfo.do` HTML fragment (2 pages)              | No shield. Fuzzy search, filtered locally.                                                                                     |
| 楽天チケット | WordPress search `?s=&q=`                         | No shield. Few listings.                                                                                                       |
| LivePocket   | `/event/search?sort=3` HTML                       | AWS WAF challenge: enable the background-tab fallback, or open the site once.                                                  |
| ASOBI TICKET | open JSON API (`/v1/public/booths`), local filter | Public data has no venue/performer; the date comes from the booth slug.                                                        |

**Blocked sites.** A 403/429/503, a WAF header, or a page without the site's results marker counts
as a block (never as "no results"). The site cools down (30 min, doubling, max 24 h), and the
settings page shows its state. With **background-tab fallback** on, a blocked page is loaded once in
an inactive tab to clear the check, and then fetched again with the new cookie.

## Develop

Requires Node.js 24+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm exec playwright install chromium   # once, for the e2e tests
pnpm check          # lint + format check + typecheck + unit tests
pnpm test           # unit and fixture tests (Vitest)
pnpm test:e2e       # loads the extension in Chromium against saved pages (mocked e2e)
LIVE=1 TAB=1 pnpm exec playwright test live   # one round against the real sites
# HEADED=1 shows the browser; DUMP=1 saves raw responses to tmp/
pnpm icons          # redraw extension/icons
```

The mocked e2e test injects an invented show (【TEST】ヨルシカ ダミー公演 2027) into saved pages;
it exists only in that test's temporary profile. It also writes light and dark screenshots of each
page to `tmp/`.

```text
extension/       the extension itself (manifest.json, icons/, src/)
  src/lib/       pure logic: matching, grouping, inbox, schedule, settings, storage
  src/sites/     one adapter per ticket site
  src/ui/        popup, inbox, settings pages (Material 3, plain CSS)
test/            unit tests; test/fixtures/ holds saved search pages of each site
e2e/             Playwright specs
docs/sites/      research notes per site (endpoints, markup, bot protection)
```

`test/fixtures/` are copies of public search-result pages, kept so the parsers can be tested
offline; anti-forgery tokens in them are replaced with `REDACTED`. The notes in `docs/sites/` also
mention research captures that are not part of this repository.
