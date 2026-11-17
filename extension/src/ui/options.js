/**
 * Settings page: keyword rows, interval, sites with their health, and
 * notification switches. Every change is saved at once through the service
 * worker.
 */
import { INTERVALS, siteEnabled, splitKeywords } from '../lib/settings.js';
import { ADAPTERS } from '../sites/index.js';
import { ago } from './format.js';
import { byId, h, icon, iconButton, load, onChange, send } from './api.js';

/**
 * Send one edit; the service worker applies it to the stored settings (never
 * a whole snapshot from this page, which another edit may have outdated).
 *
 * @param {import('../lib/settings.js').SettingsChange} change
 */
const save = (change) => send('changeSettings', { change });

/** @type {string | null} the keyword being renamed */
let editing = null;
/** What the user has typed into the rename box so far. */
let draft = '';
/** The keyword list and editor state the DOM shows now. */
let shown = '';

/** @param {string | null} keyword the row to edit, or null to stop */
function edit(keyword) {
  editing = keyword;
  draft = keyword ?? '';
  void render();
}

/**
 * Rebuild the keyword rows, but only when the list or the row being edited
 * changed: storage changes on every polling job, and rebuilding would throw
 * away the text (and IME composition) in the rename box.
 *
 * @param {string[]} keywords
 */
function renderKeywords(keywords) {
  if (editing !== null && !keywords.includes(editing)) editing = null;
  const state = JSON.stringify([keywords, editing]);
  if (state === shown) return;
  shown = state;

  byId('keywords').replaceChildren(
    ...(keywords.length === 0
      ? [h('li.empty.body-medium', null, 'No artists yet.')]
      : keywords.map((k) =>
          k === editing
            ? h(
                'li.list-item',
                null,
                h(
                  'div.text-field.dense',
                  null,
                  h('input.control', {
                    value: draft,
                    'aria-label': `Edit ${k}`,
                    oninput: (/** @type {Event} */ e) => {
                      draft = /** @type {HTMLInputElement} */ (e.target).value;
                    },
                    onkeydown: async (/** @type {KeyboardEvent} */ e) => {
                      if (e.key === 'Escape') edit(null);
                      // Enter that confirms an IME conversion is not a submit.
                      if (
                        e.key !== 'Enter' ||
                        e.isComposing ||
                        e.keyCode === 229
                      )
                        return;
                      await rename(k);
                    },
                  })
                ),
                h(
                  'div.trailing',
                  null,
                  iconButton('check', `Save ${k}`, () => rename(k)),
                  iconButton('close', 'Cancel', () => edit(null))
                )
              )
            : h(
                'li.list-item',
                null,
                h('span.kw.headline', { ondblclick: () => edit(k) }, k),
                h(
                  'div.trailing',
                  null,
                  iconButton('edit', `Edit ${k}`, () => edit(k)),
                  iconButton('trash', `Remove ${k}`, () =>
                    save({ type: 'removeKeyword', keyword: k })
                  )
                )
              )
        ))
  );
  const input = /** @type {HTMLInputElement | null} */ (
    document.querySelector('#keywords input')
  );
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

/**
 * Save the rename being typed. The editor closes first: a rename that
 * changes nothing (or a duplicate) writes nothing, so no storage event would
 * close it.
 *
 * @param {string} from
 */
async function rename(from) {
  const to =
    /** @type {HTMLInputElement | null} */ (
      document.querySelector('#keywords input')
    )?.value ?? draft;
  edit(null);
  await save({ type: 'renameKeyword', from, to });
}

async function render() {
  const { settings, schedule } = await load();

  renderKeywords(settings.keywords);

  const interval = /** @type {HTMLSelectElement} */ (byId('interval'));
  // Built once: rebuilding on every storage change would close an open menu.
  if (interval.options.length === 0)
    interval.replaceChildren(
      ...INTERVALS.map((m) =>
        h('option', { value: String(m) }, m < 60 ? `${m} min` : `${m / 60} h`)
      )
    );
  interval.value = String(settings.intervalMinutes);

  byId('queue').textContent = schedule.queue.length
    ? `Checking… ${schedule.queue.length} left`
    : schedule.lastRunAt
      ? `Last check ${ago(new Date(schedule.lastRunAt).toISOString())}`
      : 'Not checked yet';

  const now = Date.now();
  byId('sites').replaceChildren(
    ...ADAPTERS.map((a) => {
      const health = schedule.sites[a.id];
      const cooling = health && health.cooldownUntil > now;
      const host = new URL(a.home).host;
      const status = !health
        ? h('div.supporting', null, `Not checked yet · ${host}`)
        : health.lastError
          ? h(
              'div.supporting',
              null,
              h(
                'span.error-text',
                null,
                `${health.lastError}${cooling ? ` · retry in ${Math.ceil((health.cooldownUntil - now) / 60_000)} min` : ''}`
              ),
              h('br'),
              h(
                'a',
                { href: a.home, target: '_blank', rel: 'noopener' },
                'Open the site once'
              ),
              ' to pass its check, then Check now.'
            )
          : h(
              'div.supporting',
              null,
              `OK ${health.lastOkAt ? ago(new Date(health.lastOkAt).toISOString()) : ''} · `,
              h('a', { href: a.home, target: '_blank', rel: 'noopener' }, host)
            );
      const id = `site-${a.id}`;
      return h(
        `li.list-item.${health?.lastError ? 'three-line' : 'two-line'}`,
        null,
        h(
          'div.content',
          null,
          h('label.headline', { for: id }, a.name),
          status
        ),
        h('input.switch', {
          id,
          type: 'checkbox',
          role: 'switch',
          checked: siteEnabled(settings, a.id),
          onchange: (/** @type {Event} */ e) =>
            save({
              type: 'site',
              site: a.id,
              on: /** @type {HTMLInputElement} */ (e.target).checked,
            }),
        })
      );
    })
  );

  for (const id of /** @type {const} */ ([
    'notify',
    'notifyUpdates',
    'tabFallback',
  ])) {
    /** @type {HTMLInputElement} */ (byId(id)).checked = settings[id];
  }
}

const input = /** @type {HTMLTextAreaElement} */ (byId('new'));
const msg = byId('add-msg');

async function addFromInput() {
  const { settings } = await load();
  const { added, duplicates } = splitKeywords(input.value, settings.keywords);
  if (added.length) await save({ type: 'addKeywords', keywords: added });
  input.value = '';
  input.rows = 1;
  msg.textContent = [
    added.length ? `Added ${added.length}: ${added.join(', ')}.` : '',
    duplicates.length ? `Already in the list: ${duplicates.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

byId('add').addEventListener('submit', (e) => {
  e.preventDefault();
  void addFromInput();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void addFromInput();
  }
});
input.addEventListener('input', () => {
  input.rows = Math.min(8, Math.max(1, input.value.split('\n').length));
});
byId('interval').addEventListener('change', (e) =>
  save({
    type: 'set',
    key: 'intervalMinutes',
    value: Number(/** @type {HTMLSelectElement} */ (e.target).value),
  })
);
byId('check').addEventListener('click', () => send('checkNow'));
for (const id of /** @type {const} */ ([
  'notify',
  'notifyUpdates',
  'tabFallback',
])) {
  byId(id).addEventListener('change', (e) =>
    save({
      type: 'set',
      key: id,
      value: /** @type {HTMLInputElement} */ (e.target).checked,
    })
  );
}

byId('back').innerHTML = icon('arrowBack');
byId('back').addEventListener('click', () => {
  // Came from the inbox in this tab: go back to it (keeps its state).
  if (
    new URLSearchParams(location.search).get('from') === 'inbox' &&
    history.length > 1
  )
    history.back();
  else location.assign('inbox.html');
});
document
  .querySelector('form#add button[type=submit]')
  ?.insertAdjacentHTML('afterbegin', icon('add', 18));
byId('check').insertAdjacentHTML('afterbegin', icon('refresh', 18));

onChange(render);
void render();
