/**
 * Toolbar popup: the latest notifications. Clicking one opens it in the inbox.
 */
import { list, unreadCount } from '../lib/inbox.js';
import { ago } from './format.js';
import { byId, h, iconButton, load, onChange, send } from './api.js';
import { concertItem } from './items.js';

const LIMIT = 30;

async function render() {
  const { inbox, settings, schedule } = await load();
  const items = list(inbox).slice(0, LIMIT);
  const unread = unreadCount(inbox);
  byId('count').textContent = unread ? `${unread} unread` : 'All read';
  byId('read-all').hidden = unread === 0;

  byId('tools').replaceChildren(
    iconButton('refresh', 'Check now', async (e) => {
      /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
      await send('checkNow');
    }),
    iconButton('inbox', 'Open inbox', async () => {
      await send('openInbox', { hash: '' });
      window.close();
    }),
    iconButton('settings', 'Settings', () => chrome.runtime.openOptionsPage())
  );

  const main = byId('list');
  if (settings.keywords.length === 0) {
    main.replaceChildren(
      h(
        'div.empty',
        null,
        h('p', null, 'No artists yet.'),
        h(
          'button.btn.filled.state',
          { type: 'button', onclick: () => chrome.runtime.openOptionsPage() },
          'Add artists'
        )
      )
    );
  } else if (items.length === 0) {
    main.replaceChildren(
      h(
        'div.empty',
        null,
        schedule.queue.length ? 'Checking…' : 'No live info yet.'
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
              c.starred ? 'Unstar' : 'Star (keep)',
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
    : 'never';
  byId('status').replaceChildren(
    h(
      'span',
      null,
      schedule.queue.length
        ? `Checking… ${schedule.queue.length} left`
        : `Last check: ${last}`
    ),
    h('span', null, `${settings.keywords.length} artist(s)`)
  );
}

byId('read-all').addEventListener('click', () => send('readAll'));
onChange(render);
void render();
