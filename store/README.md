# Chrome Web Store listing

What to enter in the [developer dashboard](https://chrome.google.com/webstore/devconsole), tab by
tab. The images in this folder come from `pnpm store-assets`; the zip from `pnpm package`
(`dist/oshi-live-alert-v<version>.zip`).

## Package

Upload `dist/oshi-live-alert-v<version>.zip`. The name and the summary come from the zip
(`_locales/<lang>/messages.json`: `appName`, `appDescription`), in English (default) and Japanese.

## Store listing

Fill in the English listing, then add **Japanese** under the language menu and fill it in too.

| Field              | English                                            | Japanese                                       |
| ------------------ | -------------------------------------------------- | ---------------------------------------------- |
| Description        | [`en/description.txt`](en/description.txt)         | [`ja/description.txt`](ja/description.txt)     |
| Screenshots        | `en/screenshot-1-inbox.png` … `-4-dark.png`        | `ja/screenshot-1-inbox.png` … `-4-dark.png`    |
| Small promo tile   | [`en/promo-440x280.png`](en/promo-440x280.png)     | [`ja/promo-440x280.png`](ja/promo-440x280.png) |
| Store icon         | [`icon-128.png`](icon-128.png) (both)              |                                                |
| Category           | Productivity → Tools                               |                                                |
| Language (listing) | English, 日本語                                    |                                                |
| Official URL       | none                                               |                                                |
| Homepage URL       | https://github.com/shino369/oshi-live-alert        |                                                |
| Support URL        | https://github.com/shino369/oshi-live-alert/issues |                                                |
| Mature content     | No                                                 |                                                |

## Privacy practices

**Single purpose**

> Alerts the user when new live and concert listings for the artists they follow appear on
> Japanese ticket sites and reminds them about performances they mark as purchased in the inbox.

**Permission justifications**

| Permission         | Justification                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`          | Keeps the user's artist list, settings, the inbox of found shows, the check schedule, and site health in chrome.storage.local. Nothing is synced or sent anywhere.                                                                                                                                                                                                             |
| `unlimitedStorage` | The inbox grows with every followed artist, and the extension stores small poster copies (data URLs) for sites whose images stop loading after their bot check, plus an optional custom image of up to 1 MB. Together these can exceed the 10 MB default quota of chrome.storage.local.                                                                                        |
| `alarms`           | Runs ticket-site checks, spaces requests at least 3 seconds apart per site, and schedules reminders before performances the user plans to attend.                                                                                                                                                                                                                              |
| `idle`             | Checks whether the device is active so a ticket reminder can wait until the user returns.                                                                                                                                                                                                                                                                                      |
| `notifications`    | Shows system notifications about new shows and reminders for purchased tickets. Clicking a reminder opens the concert in the inbox. The user can turn notifications off in Settings.                                                                                                                                                                                           |
| `offscreen`        | Some ticket sites answer with HTML pages. Service workers have no DOMParser, so the extension parses those pages in an offscreen document (reason DOM_PARSER). The document has no UI and loads no remote code.                                                                                                                                                                |
| `scripting`        | Used only by the optional "Get past bot checks in a background tab" setting, off by default. When a ticket site answers with a browser check, the extension opens that site's search page in an inactive tab, reads the page to see whether the check passed, fetches the same search results from inside that tab, and closes it. It never injects into tabs the user opened. |

**Host permissions**

> The extension fetches search results from the ticket sites it supports, which do not allow
> cross-origin requests: eplus.jp (e+), l-tike.com (ローチケ), ticket.rakuten.co.jp (楽天チケット),
> asobi-ticket.api.app.t-riple.com (ASOBI TICKET's public API), t.pia.jp (チケットぴあ),
> livepocket.jp (LivePocket), www.zan-live.com (ZAN-LIVE), and zaiko.io (ZAIKO): one host per site,
> no wildcards. For e+ and 楽天チケット it also reads a listing's own page on the same host to find
> its poster, and for LivePocket it stores small copies of posters from livepocket.jp. Only sites the user has switched on are contacted, and only for the artists the user
> added.

**Remote code:** No, I am not using remote code. (All scripts are in the package;
`script-src 'self'`.)

**Data usage:** tick none of the data types. The developer receives nothing: there is no server,
analytics, or account, and the inbox and settings stay in chrome.storage.local. The only data that
leaves the browser is the artist names the user typed, sent as search words to the ticket sites
the user switched on (with the browser's own cookies for those sites, as in a normal visit). That
is the single purpose itself and is disclosed in the description and the privacy policy. Then tick
all three certifications (no selling or transfer to third parties, no use unrelated to the single
purpose, no use for creditworthiness or lending).

**Privacy policy URL:** https://github.com/shino369/oshi-live-alert/blob/main/PRIVACY.md (live
once this branch is merged into `main`).

## Distribution

Free, public, all regions (Japan is the main audience). No in-app purchases, ads, or donations:
the fan-creation guidelines of 「魔法少女ノ魔女裁判」 (§9) allow fan-made apps only when they are
completely free and earn nothing.

## Test instructions (for the reviewer)

> No account or login is needed. Open Settings (it opens on install), add an artist such as
> YOASOBI or Aimer, and wait a few seconds: the first check runs at once and fills the inbox
> (toolbar icon → Open inbox). Settings → Ticket sites shows each site's state. ローチケ may be
> blocked by its bot shield in automated or headless browsers; the other default sites answer
> normally.
