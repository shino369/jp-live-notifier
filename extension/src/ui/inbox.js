/**
 * Inbox page (M3 list-detail): notification list on the left, the selected
 * one on the right (`#<id>` selects; `#unread` / `#starred` set the filter).
 */
import { localize, noteText, plural, t } from '../lib/i18n.js';
import { clearableIds, list, unreadCount } from '../lib/inbox.js';
import { fold } from '../lib/text.js';
import { thumbKey } from '../lib/thumbs.js';
import { ADAPTERS, SITE_NAMES } from '../sites/index.js';
import { ago, formatDates, formatInterval } from './format.js';
import {
  applyDecor,
  byId,
  fill,
  h,
  icon,
  iconButton,
  load,
  onChange,
  send,
} from './api.js';
import { concertItem } from './items.js';

localize(document);

/** @type {'all' | 'unread' | 'starred'} */
let filter = 'all';
/** @type {string | null} */
let selected = null;
let query = '';

function readHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === 'unread' || hash === 'starred' || hash === 'all') {
    filter = hash;
    selected = null;
  } else if (hash) {
    selected = hash;
  }
}

/** @param {string | null} id */
function select(id) {
  selected = id;
  history.replaceState(
    null,
    '',
    id ? `#${encodeURIComponent(id)}` : location.pathname
  );
  void render();
}

/** Settings open in this tab, so the browser's Back and the page's own back arrow return here. */
const openSettings = () => location.assign('options.html?from=inbox');

/** @param {import('../lib/inbox.js').Concert} c */
const searchText = (c) =>
  fold(
    [
      c.title,
      c.venue,
      c.prefecture,
      ...c.keywords,
      ...c.performers,
      ...c.offers.map((o) => SITE_NAMES[o.site]),
    ].join(' ')
  );

/** @param {number} count */
function confirmClear(count) {
  const dialog = /** @type {HTMLDialogElement} */ (byId('clear-dialog'));
  byId('clear-text').textContent = plural('clearDialogText', count, count);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'ok'),
      { once: true }
    )
  );
}

async function render() {
  const { inbox, schedule, settings } = await load();
  const all = list(inbox, filter);
  const q = fold(query);
  const items = q ? all.filter((c) => searchText(c).includes(q)) : all;
  const current = selected ? inbox.concerts[selected] : undefined;
  if (current && !current.read) {
    // Opening a notification marks it read (the change re-renders).
    void send('read', { id: current.id, read: true });
  }
  document.body.classList.toggle('detail-open', Boolean(selected));

  const clearable = clearableIds(inbox).length;
  byId('tools').replaceChildren(
    iconButton('read', t('markAllRead'), () => send('readAll')),
    iconButton('clearAll', t('clearRead', clearable), async () => {
      if (clearable === 0) return;
      if (!(await confirmClear(clearable))) return;
      await send('clearRead');
      if (
        selected &&
        inbox.concerts[selected]?.read &&
        !inbox.concerts[selected]?.starred
      )
        select(null);
    }),
    iconButton('refresh', t('checkNow'), () => send('checkNow')),
    iconButton('settings', t('settings'), openSettings)
  );

  const unread = unreadCount(inbox);
  const starred = Object.values(inbox.concerts).filter((c) => c.starred).length;
  byId('filters').replaceChildren(
    ...[
      ['all', t('filterAll', Object.keys(inbox.concerts).length)],
      ['unread', t('filterUnread', unread)],
      ['starred', t('filterStarred', starred)],
    ].map(([key, label]) =>
      h(
        `button.chip.filter.state${filter === key ? '.selected' : ''}`,
        {
          type: 'button',
          'aria-pressed': String(filter === key),
          html: filter === key ? icon('check', 18) : null,
          onclick: () => {
            filter = /** @type {typeof filter} */ (key);
            void render();
          },
        },
        label
      )
    )
  );

  byId('list').replaceChildren(
    ...(items.length === 0
      ? [
          h(
            'div.empty',
            null,
            settings.keywords.length === 0
              ? t('emptyStart')
              : filter === 'starred'
                ? t('emptyStarred')
                : filter === 'unread'
                  ? t('emptyUnread')
                  : t('emptyAll')
          ),
        ]
      : items.map((c) =>
          concertItem(c, {
            selected: c.id === selected,
            onOpen: () => select(c.id),
            actions: [
              iconButton(
                c.starred ? 'starFilled' : 'star',
                c.starred ? t('unstar') : t('star'),
                (e) => {
                  e.stopPropagation();
                  void send('star', { id: c.id, starred: !c.starred });
                },
                c.starred ? 'selected' : ''
              ),
              c.starred
                ? null
                : iconButton(
                    'trash',
                    t('delete'),
                    (e) => {
                      e.stopPropagation();
                      if (c.id === selected) select(null);
                      void send('delete', { ids: [c.id] });
                    },
                    'del'
                  ),
            ],
          })
        ))
  );

  byId('status').textContent = schedule.queue.length
    ? t('checkingLeft', schedule.queue.length)
    : [
        t(
          'lastCheck',
          schedule.lastRunAt
            ? ago(new Date(schedule.lastRunAt).toISOString())
            : t('neverChecked')
        ),
        plural(
          'artistCount',
          settings.keywords.length,
          settings.keywords.length
        ),
        t('checkInterval', formatInterval(settings.intervalMinutes)),
      ].join(t('statusSeparator'));

  renderDetail(current);
}

/**
 * One M3 list item with a leading icon.
 *
 * @param {import('./api.js').IconName} name
 * @param {string} headline
 * @param {string | null} [supporting]
 */
const fact = (name, headline, supporting = null) =>
  h(
    `li.list-item${supporting ? '.two-line' : ''}`,
    null,
    h('span.leading-icon', { html: icon(name) }),
    h(
      'div.content',
      null,
      h('div.headline', null, headline),
      supporting ? h('div.supporting', null, supporting) : null
    )
  );

/**
 * What each poster showed last on this page: a stored copy, its URL, or ''
 * after the image failed. Re-renders (every job changes the schedule) show
 * it at once, without a blank frame and without asking a bot-checked site
 * for a refused image again.
 *
 * @type {Map<string, string>}
 */
const posterSrc = new Map();

/**
 * The concert's poster: the copy the service worker stored (bot-checked
 * sites refuse the image itself once their pass expires), else the image's
 * URL, else a placeholder when it fails to load.
 *
 * @param {string} url
 */
function poster(url) {
  const box = h('div.d-poster');
  /** @param {string} src */
  const show = (src) => {
    posterSrc.set(url, src);
    fill(box, [
      src
        ? h('img.d-image', {
            src,
            alt: '',
            referrerpolicy: 'no-referrer',
            onerror: () => show(''),
          })
        : h('div.d-image.d-poster-missing', {
            role: 'img',
            'aria-label': t('posterMissing'),
            html: icon('image'),
          }),
    ]);
  };
  const last = posterSrc.get(url);
  if (last !== undefined) show(last);
  const key = thumbKey(url);
  void chrome.storage.local
    .get(key)
    .then(
      (r) => /** @type {string | undefined} */ (r[key]),
      () => undefined
    )
    .then((stored) => {
      // A stored copy wins; else keep what is known (the URL, or the
      // placeholder after a failure); else try the URL.
      const src = stored ?? last ?? url;
      if (src !== last) show(src);
    });
  return box;
}

/** @param {import('../lib/inbox.js').Concert | undefined} c */
function renderDetail(c) {
  const main = byId('detail');
  const back = iconButton(
    'arrowBack',
    t('backToList'),
    () => select(null),
    'back'
  );
  if (!c) {
    fill(main, [
      selected ? h('div.detail-bar', null, back) : null,
      h('div.empty', null, selected ? t('detailDeleted') : t('detailSelect')),
    ]);
    return;
  }
  const offers = [...c.offers].sort(
    (a, b) =>
      a.site.localeCompare(b.site) || a.firstSeenAt.localeCompare(b.firstSeenAt)
  );
  const period = (/** @type {import('../lib/inbox.js').Offer} */ o) =>
    [o.saleStart, o.saleEnd].filter(Boolean).join(' – ');
  fill(main, [
    h(
      'div.detail-bar',
      null,
      back,
      h('span.spacer'),
      h(
        'div.d-actions',
        { style: 'display:flex' },
        iconButton(
          c.starred ? 'starFilled' : 'star',
          c.starred ? t('unstar') : t('star'),
          () => send('star', { id: c.id, starred: !c.starred }),
          c.starred ? 'selected' : ''
        ),
        // Deselect first: while it is still selected, a render triggered by
        // the storage change would mark it read again.
        iconButton('mail', t('markUnread'), async () => {
          select(null);
          await send('read', { id: c.id, read: false });
        }),
        c.starred
          ? null
          : iconButton('trash', t('delete'), async () => {
              select(null);
              await send('delete', { ids: [c.id] });
            })
      )
    ),
    h(
      'div.d-body',
      null,
      h(
        'div.d-keywords',
        null,
        ...c.keywords.flatMap((k, i) => [
          i > 0 ? ' · ' : null,
          h(
            'button.d-keyword',
            {
              type: 'button',
              title: t('showFor', k),
              onclick: () => searchFor(k),
            },
            k
          ),
        ])
      ),
      h('h1.d-title', null, c.title),
      c.update ? h('div.d-update', null, noteText(c.update)) : null,
      c.image ? poster(c.image) : null,
      h(
        'ul.list.facts',
        null,
        fact('event', formatDates(c.dates, c.time)),
        fact(
          'place',
          [c.venue, c.prefecture].filter(Boolean).join(' · ') || t('venueTba')
        ),
        fact(
          'person',
          [...new Set([...c.keywords, ...c.performers])].join(' / ')
        ),
        fact(
          'schedule',
          t('foundAt', new Date(c.createdAt).toLocaleString()),
          c.updatedAt !== c.createdAt
            ? t('updatedAt', new Date(c.updatedAt).toLocaleString())
            : null
        )
      ),
      h('hr.divider'),
      h('h2.list-subheader', null, t('tickets', offers.length)),
      h(
        'ul.list.offers',
        null,
        ...offers.map((o) =>
          h(
            'li.item.list-item.three-line',
            null,
            h('span.leading-icon', { html: icon('ticket') }),
            h(
              'div.content',
              null,
              h(
                'div.overline',
                null,
                [SITE_NAMES[o.site] ?? o.site, o.saleLabel]
                  .filter(Boolean)
                  .join(' · ')
              ),
              h('div.headline', null, o.title),
              o.venue && o.venue !== c.venue
                ? h('div.supporting', null, o.venue)
                : null,
              o.dates.length && o.dates.join() !== c.dates.join()
                ? h('div.supporting', null, formatDates(o.dates, o.time))
                : null,
              period(o) ? h('div.supporting', null, period(o)) : null
            ),
            h(
              'a.go.btn.outlined.has-icon.state',
              {
                href: o.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                // The icon as markup, the label as text (never as HTML).
                html: icon('open', 18),
              },
              t('openListing')
            )
          )
        )
      ),
      h('hr.divider'),
      h('h2.list-subheader', null, t('searchArtistOn')),
      h(
        'div.search-links.chips',
        null,
        ...c.keywords.flatMap((k) =>
          ADAPTERS.map((a) =>
            h(
              'a.chip.assist.has-icon.state',
              {
                href: a.searchUrl(k),
                target: '_blank',
                rel: 'noopener noreferrer',
                html: icon('search', 18),
              },
              `${a.name}${c.keywords.length > 1 ? ` (${k})` : ''}`
            )
          )
        )
      )
    ),
  ]);
}

/**
 * Put text in the search field and filter the list by it.
 *
 * @param {string} text
 */
function searchFor(text) {
  const field = /** @type {HTMLInputElement} */ (byId('search'));
  field.value = text;
  query = text;
  void render();
}

byId('search-icon').innerHTML = icon('search');
byId('search').addEventListener('input', (e) => {
  query = /** @type {HTMLInputElement} */ (e.target).value;
  void render();
});

document.addEventListener('keydown', async (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (document.querySelector('dialog[open]')) return;
  const rows = [...document.querySelectorAll('#list .row')].map(
    (r) => /** @type {HTMLElement} */ (r).dataset.id
  );
  const i = rows.indexOf(selected ?? '');
  if (e.key === 'j' || e.key === 'ArrowDown')
    select(rows[Math.min(rows.length - 1, i + 1)] ?? null);
  if (e.key === 'k' || e.key === 'ArrowUp')
    select(rows[Math.max(0, i - 1)] ?? null);
  if (e.key === 'Escape' && selected) select(null);
  if (e.key === 's' && selected) {
    const { inbox } = await load();
    void send('star', {
      id: selected,
      starred: !inbox.concerts[selected]?.starred,
    });
  }
});

window.addEventListener('hashchange', () => {
  readHash();
  void render();
});

readHash();
onChange(render);
void render();
void applyDecor('inbox');
