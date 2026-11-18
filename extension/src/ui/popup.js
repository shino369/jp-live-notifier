/**
 * Toolbar popup: the latest notifications. Clicking one opens it in the inbox.
 */
import { localize, plural, t } from '../lib/i18n.js';
import { list, unreadCount } from '../lib/inbox.js';
import { ago } from './format.js';
import {
  applyDecor,
  byId,
  h,
  iconButton,
  load,
  onChange,
  send,
} from './api.js';
import { concertItem } from './items.js';

const LIMIT = 30;

localize(document);

async function render() {
  const { inbox, settings, schedule } = await load();
  const items = list(inbox).slice(0, LIMIT);
  const unread = unreadCount(inbox);
  byId('count').textContent = unread ? t('unreadCount', unread) : t('allRead');
  byId('read-all').hidden = unread === 0;

  byId('tools').replaceChildren(
    iconButton('refresh', t('checkNow'), async (e) => {
      /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
      await send('checkNow');
    }),
    iconButton('inbox', t('openInbox'), async () => {
      await send('openInbox', { hash: '' });
      window.close();
    }),
    iconButton('settings', t('settings'), () =>
      chrome.runtime.openOptionsPage()
    )
  );

  const main = byId('list');
  if (settings.keywords.length === 0) {
    main.replaceChildren(
      h(
        'div.empty',
        null,
        h('p', null, t('noArtists')),
        h(
          'button.btn.filled.state',
          { type: 'button', onclick: () => chrome.runtime.openOptionsPage() },
          t('addArtists')
        )
      )
    );
  } else if (items.length === 0) {
    main.replaceChildren(
      h(
        'div.empty',
        null,
        schedule.queue.length ? t('checking') : t('noLiveInfo')
      )
    );
  } else {
    main.replaceChildren(
      ...items.map((c) =>
        concertItem(c, {
          cls: 'item',
          onOpen: async () => {
            await send('open', { id: c.id });
            window.close();
          },
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
          ],
        })
      )
    );
  }

  const last = schedule.lastRunAt
    ? ago(new Date(schedule.lastRunAt).toISOString())
    : t('neverChecked');
  byId('status').replaceChildren(
    h(
      'span',
      null,
      schedule.queue.length
        ? t('checkingLeft', schedule.queue.length)
        : t('lastCheck', last)
    ),
    h(
      'span',
      null,
      plural('artistCount', settings.keywords.length, settings.keywords.length)
    )
  );
}

byId('read-all').addEventListener('click', () => send('readAll'));
onChange(render);
void render();
void applyDecor('popup');
