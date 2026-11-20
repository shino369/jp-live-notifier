/**
 * The M3 list item for one concert, shared by the popup and the inbox list.
 *
 * Layout (three-line list item):
 *   artist(s)                       [badge] 3 min ago
 *   Title (bold while unread)               [actions]
 *   2027/01/29 (Fri) 20:30 · Venue
 *   Also on LivePocket               (update note, unread only)
 *   [e+] [LivePocket]                (site chips, own line)
 */
import { noteText, t } from '../lib/i18n.js';
import { SITE_NAMES } from '../sites/index.js';
import { ago, formatDates } from './format.js';
import { h } from './api.js';

/**
 * Site chips: one assist chip per site, linking to that site's listing.
 *
 * @param {import('../lib/inbox.js').Concert} c
 */
export function siteChips(c) {
  /** @type {Map<string, string>} site → first listing URL */
  const sites = new Map();
  for (const o of c.offers) if (!sites.has(o.site)) sites.set(o.site, o.url);
  return h(
    'div.chips',
    null,
    ...[...sites].map(([site, url]) =>
      h(
        'a.chip.assist.state',
        {
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('openOnSite', SITE_NAMES[site] ?? site),
          // The chip opens the site; it must not also open the row.
          onclick: (/** @type {Event} */ e) => e.stopPropagation(),
        },
        SITE_NAMES[site] ?? site
      )
    )
  );
}

/**
 * @param {import('../lib/inbox.js').Concert} c
 * @param {{ cls?: string, selected?: boolean, when?: string, prompt?: string, onOpen: () => void, actions: Array<HTMLElement | null> }} options
 */
export function concertItem(
  c,
  {
    cls = '',
    selected = false,
    when = formatDates(c.dates, c.time),
    prompt,
    onOpen,
    actions,
  }
) {
  return h(
    `div.${['row', cls, 'list-item', 'three-line', 'state', c.read ? 'read' : 'unread', selected ? 'selected' : ''].filter(Boolean).join('.')}`,
    {
      role: 'option',
      'aria-selected': String(selected),
      'data-id': c.id,
      onclick: onOpen,
    },
    h(
      'div.content',
      null,
      h('div.overline', null, c.keywords.join(', ')),
      h('div.headline.row-title', null, c.title),
      h('div.supporting', null, [when, c.venue].filter(Boolean).join(' · ')),
      prompt ? h('div.supporting', null, prompt) : null,
      c.update && !c.read ? h('div.update', null, noteText(c.update)) : null,
      siteChips(c)
    ),
    h(
      'div.trail',
      null,
      h(
        'span.when',
        null,
        c.read
          ? null
          : h('span.badge-small', {
              role: 'img',
              'aria-label': t('unreadBadge'),
            }),
        h('span.trailing-text', null, ago(c.updatedAt))
      ),
      h('div.actions', null, ...actions.filter(Boolean))
    )
  );
}
