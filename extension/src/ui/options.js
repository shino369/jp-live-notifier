/**
 * Settings page: keyword rows, interval, sites with their health, and
 * notification switches. Every change is saved at once through the service
 * worker.
 */
import {
  applyDecorChange,
  DECOR_KEY,
  DECOR_PX,
  normalizeDecor,
} from '../lib/decor.js';
import { errorText, localize, t } from '../lib/i18n.js';
import {
  INTERVALS,
  splitKeywords,
  TICKET_REMINDER_HOURS,
} from '../lib/settings.js';
import { toDataUrl } from '../lib/thumbs.js';
import { ADAPTERS, adapterOn } from '../sites/index.js';
import { ago, formatInterval } from './format.js';
import {
  applyDecor,
  byId,
  h,
  icon,
  iconButton,
  load,
  onChange,
  send,
} from './api.js';

localize(document);

/**
 * Send one edit; the service worker applies it to the stored settings (never
 * a whole snapshot from this page, which another edit may have outdated).
 *
 * @param {import('../lib/settings.js').SettingsChange} change
 */
const save = (change) => send('changeSettings', { change });

/** Stands for the link in a message, which is split around it. */
const LINK = '\uE000';

/**
 * A message with an element where `LINK` was (the message decides where
 * the link goes in the sentence).
 *
 * @param {string} message
 * @param {HTMLElement} link
 * @returns {Array<string | HTMLElement>}
 */
const withLink = (message, link) => {
  const [before, after = ''] = message.split(LINK);
  return [before, link, after].filter((part) => part !== '');
};

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
      ? [h('li.empty.body-medium', null, t('noArtists'))]
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
                    'aria-label': t('editArtist', k),
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
                  iconButton('check', t('saveArtist', k), () => rename(k)),
                  iconButton('close', t('cancel'), () => edit(null))
                )
              )
            : h(
                'li.list-item',
                null,
                h('span.kw.headline', { ondblclick: () => edit(k) }, k),
                h(
                  'div.trailing',
                  null,
                  iconButton('edit', t('editArtist', k), () => edit(k)),
                  iconButton('trash', t('removeArtist', k), () =>
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
        h('option', { value: String(m) }, formatInterval(m))
      )
    );
  interval.value = String(settings.intervalMinutes);

  const reminders = /** @type {HTMLSelectElement} */ (
    byId('ticketReminderHours')
  );
  if (reminders.options.length === 0)
    reminders.replaceChildren(
      ...TICKET_REMINDER_HOURS.map((hours) =>
        h(
          'option',
          { value: String(hours) },
          hours === 0 ? t('ticketReminderOff') : formatInterval(hours * 60)
        )
      )
    );
  reminders.value = String(settings.ticketReminderHours);

  byId('queue').textContent = schedule.queue.length
    ? t('checkingLeft', schedule.queue.length)
    : schedule.lastRunAt
      ? t('lastCheck', ago(new Date(schedule.lastRunAt).toISOString()))
      : t('notCheckedYet');

  const now = Date.now();
  byId('sites').replaceChildren(
    ...ADAPTERS.map((a) => {
      const health = schedule.sites[a.id];
      const cooling = health && health.cooldownUntil > now;
      const host = new URL(a.home).host;
      const status = !health
        ? h('div.supporting', null, t('siteNotChecked', host))
        : health.lastError
          ? h(
              'div.supporting',
              null,
              h(
                'span.error-text',
                null,
                [
                  errorText(health.lastError),
                  cooling
                    ? t(
                        'siteRetryIn',
                        Math.ceil((health.cooldownUntil - now) / 60_000)
                      )
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              ),
              h('br'),
              ...withLink(
                t('siteBlockedHint', LINK),
                h(
                  'a',
                  { href: a.home, target: '_blank', rel: 'noopener' },
                  t('siteBlockedLink')
                )
              )
            )
          : h(
              'div.supporting',
              null,
              `${t('siteOk', health.lastOkAt ? ago(new Date(health.lastOkAt).toISOString()) : '').trim()} · `,
              h('a', { href: a.home, target: '_blank', rel: 'noopener' }, host)
            );
      const id = `site-${a.id}`;
      // Shown in the row, not behind an icon: read before the switch is
      // flipped, on touch and by screen readers (aria-describedby) too.
      const terms =
        a.optIn &&
        h(
          'div.supporting.site-terms',
          { id: `${id}-terms` },
          h('span.site-terms-icon', { html: icon('warning', 18) }),
          h(
            'span',
            null,
            `${t('siteTermsWarning')} · `,
            h(
              'a',
              { href: a.optIn.terms, target: '_blank', rel: 'noopener' },
              t('siteTermsLink')
            )
          )
        );
      return h(
        `li.list-item.${health?.lastError || terms ? 'three-line' : 'two-line'}`,
        null,
        h(
          'div.content',
          null,
          h('label.headline', { for: id }, a.name),
          status,
          terms || null
        ),
        h('input.switch', {
          id,
          type: 'checkbox',
          role: 'switch',
          'aria-describedby': terms ? terms.id : null,
          checked: adapterOn(settings, a),
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
    added.length ? t('addedArtists', added.length, added.join(', ')) : '',
    duplicates.length ? t('alreadyListed', duplicates.join(', ')) : '',
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
byId('ticketReminderHours').addEventListener('change', (e) =>
  save({
    type: 'set',
    key: 'ticketReminderHours',
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

// ---------------------------------------------------------------- illustration

const DECOR_HINT = t('decorHint');

const readDecor = async () =>
  normalizeDecor((await chrome.storage.local.get([DECOR_KEY]))[DECOR_KEY]);

/** @param {import('../lib/decor.js').Decor} decor */
function renderDecor(decor) {
  /** @type {HTMLSelectElement} */ (byId('decor')).value = decor.mode;
  byId('decor-custom').hidden = decor.mode !== 'custom';
  byId('decor-preview').style.backgroundImage = decor.image
    ? `url("${decor.image.url}")`
    : '';
  byId('decor-choose').textContent = decor.image
    ? t('decorReplace')
    : t('decorChoose');
}

/**
 * Save one edit. Only this page writes the choice, so it goes straight to
 * storage (no worker round trip: a worker still running older code would
 * drop the message); every page follows through `applyDecor`.
 *
 * @param {import('../lib/decor.js').DecorChange} change
 */
async function saveDecor(change) {
  const next = applyDecorChange(await readDecor(), change);
  renderDecor(next);
  await chrome.storage.local.set({ [DECOR_KEY]: next });
}

/** Kept byte for byte up to this size, so an animated GIF/WebP/PNG moves. */
const KEEP_BYTES = 1_000_000;
const KEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** @param {Blob} file @returns {Promise<string>} */
const dataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * The picked file as stored: as is when small (animation kept), else at most
 * DECOR_PX on its longest side as a still WebP (a canvas draws one frame;
 * transparency kept).
 *
 * @param {File} file
 * @returns {Promise<{ image: import('../lib/decor.js').DecorImage, shrunk: boolean }>}
 */
async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  if (file.size <= KEEP_BYTES && KEPT_TYPES.includes(file.type)) {
    const { width, height } = bitmap;
    bitmap.close();
    return {
      image: { url: await dataUrl(file), width, height },
      shrunk: false,
    };
  }
  const scale = Math.min(1, DECOR_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (
    canvas.getContext('2d')
  );
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  const url = toDataUrl(new Uint8Array(await out.arrayBuffer()), 'image/webp');
  return { image: { url, width, height }, shrunk: true };
}

byId('decor-msg').textContent = DECOR_HINT;
byId('decor').addEventListener('change', (e) => {
  const mode = /** @type {HTMLSelectElement} */ (e.target).value;
  void saveDecor({ mode: /** @type {any} */ (mode) }).then(() => {
    // Choosing "Your image" with none stored yet: go straight to the picker.
    if (mode === 'custom' && !byId('decor-preview').style.backgroundImage)
      byId('decor-file').click();
  });
});
byId('decor-choose').addEventListener('click', () =>
  byId('decor-file').click()
);
byId('decor-file').addEventListener('change', async (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const msg = byId('decor-msg');
  try {
    const { image, shrunk } = await readImage(file);
    await saveDecor({ mode: 'custom', image });
    msg.textContent = shrunk ? t('decorShrunk', DECOR_PX) : DECOR_HINT;
  } catch {
    msg.replaceChildren(h('span.error-text', null, t('decorError')));
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[DECOR_KEY])
    renderDecor(normalizeDecor(changes[DECOR_KEY].newValue));
});
void readDecor().then(renderDecor);
void applyDecor('options');

onChange(render);
void render();
