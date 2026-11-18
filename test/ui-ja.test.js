// @vitest-environment jsdom
/**
 * The three pages with the Japanese catalog (the browser language picks it
 * in Chrome): no English text from the catalog is left on them, no message
 * key shows instead of its text, and the page says it is Japanese.
 */
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { note } from '../extension/src/lib/i18n.js';
import { emptyInbox, ingest, markRead } from '../extension/src/lib/inbox.js';
import { emptySchedule } from '../extension/src/lib/schedule.js';
import { defaultSettings } from '../extension/src/lib/settings.js';
import { fakeChrome, fakeI18n, loadPage, settle } from './fake-chrome.js';

const LOCALES = path.resolve(import.meta.dirname, '../extension/_locales');
/** @param {string} locale @returns {Record<string, { message: string }>} */
const catalog = (locale) =>
  JSON.parse(
    fs.readFileSync(path.join(LOCALES, locale, 'messages.json'), 'utf8')
  );
const en = catalog('en');
const ja = catalog('ja');
const jaText = Object.values(ja)
  .map((m) => m.message)
  .join('\n');

/** Escape a string for a RegExp. @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * English words and phrases that belong to the English catalog only: the
 * parts of each translated message around its placeholders, unless the
 * Japanese catalog uses them too (HTTP, PNG, …).
 */
const english = Object.entries(en)
  .filter(([key, m]) => m.message !== ja[key].message)
  .flatMap(([, m]) => m.message.split(/\$[A-Za-z0-9_@]+\$/))
  .map((s) => s.trim().replace(/^[\s·:(,.]+|[\s·:),.]+$/g, ''))
  .filter((s) => /[A-Za-z]{3,}/.test(s) && !jaText.includes(s))
  .map((s) => ({ s, re: new RegExp(`(?<![A-Za-z])${escape(s)}(?![A-Za-z])`) }));

/** Message keys in camelCase (as t() shows a missing one). */
const keys = Object.keys(en)
  .filter((k) => /[a-z][A-Z]/.test(k))
  .map((k) => ({ k, re: new RegExp(`\\b${k}\\b`) }));

/** Everything a user can read or hear on the page. */
function readable() {
  const attrs = [
    ...document.querySelectorAll('[title],[aria-label],[placeholder]'),
  ]
    .flatMap((el) =>
      ['title', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a))
    )
    .filter(Boolean);
  return [document.title, document.body.textContent, ...attrs].join('\n');
}

/** @param {string} text @param {string} page */
function expectJapanese(text, page) {
  expect(document.documentElement.lang, page).toBe('ja');
  for (const { s, re } of english)
    expect(re.test(text), `${page}: English "${s}" left`).toBe(false);
  for (const { k, re } of keys)
    expect(re.test(text), `${page}: key ${k} shown`).toBe(false);
}

const NOW = '2026-11-18T09:00:00.000Z';
/** @param {Partial<import('../extension/src/lib/inbox.js').Listing>} over */
const listing = (over) => ({
  site: 'eplus',
  siteId: '1',
  url: 'https://eplus.jp/sf/detail/1',
  title: 'ヨルシカ 公演 2027',
  performers: ['ヨルシカ'],
  venue: '日本武道館',
  prefecture: '東京都',
  dates: ['2099-12-05', '2099-12-06', '2099-12-07'],
  time: null,
  saleLabel: '一般発売',
  saleStart: '2099/10/01 10:00',
  saleEnd: '2099/11/30 23:59',
  image: null,
  ...over,
});

/** An inbox with a selected show, an unread update, and a starred one. */
function inbox() {
  let r = ingest(emptyInbox(), {
    keyword: 'ヨルシカ',
    listings: [
      listing({}),
      listing({
        siteId: '2',
        title: '花譜 ワンマン',
        performers: ['花譜'],
        venue: 'Zepp Haneda',
        dates: [],
      }),
    ],
    now: NOW,
  });
  const [shown, other] = r.created;
  let state = markRead(r.state, other);
  state = {
    ...state,
    concerts: {
      ...state.concerts,
      [other]: {
        ...state.concerts[other],
        read: false,
        starred: true,
        update: note('updateAlsoOn', 'ローチケ'),
      },
    },
  };
  return { state, shown };
}

const now = Date.now();
const schedule = {
  ...emptySchedule(),
  lastRunAt: now - 9 * 60_000,
  sites: {
    eplus: {
      lastRequestAt: now,
      cooldownUntil: 0,
      failures: 0,
      lastOkAt: now - 60_000,
      lastError: null,
      lastCount: 2,
    },
    livepocket: {
      lastRequestAt: now,
      cooldownUntil: now + 10 * 60_000,
      failures: 1,
      lastOkAt: null,
      lastError: 'HTTP 202 (challenge)',
      lastCount: null,
    },
    ltike: {
      lastRequestAt: now,
      cooldownUntil: 0,
      failures: 1,
      lastOkAt: null,
      lastError: 'not a results page (bot check or site change)',
      lastCount: null,
    },
  },
};

/**
 * @param {string} page
 * @param {string} module
 * @param {Record<string, any>} data
 */
async function open(page, module, data) {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline')))
  );
  const fake = fakeChrome({ data, locale: 'ja' });
  /** @type {any} */ (globalThis).chrome = fake.chrome;
  loadPage(page);
  await import('../extension/src/background.js');
  await import(/* @vite-ignore */ module);
  await settle();
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Japanese pages', () => {
  test('the check itself finds English and raw keys', () => {
    document.documentElement.lang = 'ja';
    expect(() => expectJapanese('Last check: 3 min ago', 'x')).toThrow(
      /English/
    );
    expect(() => expectJapanese('checkNow', 'x')).toThrow(/key checkNow/);
    expect(() =>
      expectJapanese('推しライブアラート · eplus.jp · HTTP 503', 'x')
    ).not.toThrow();
  });

  test('popup', async () => {
    const { state } = inbox();
    await open('ui/popup.html', '../extension/src/ui/popup.js', {
      settings: { ...defaultSettings(), keywords: ['ヨルシカ', '花譜'] },
      inbox: state,
      schedule,
    });
    expect(document.querySelector('h1')?.textContent).toBe(
      '推しライブアラート'
    );
    expectJapanese(readable(), 'popup');
  });

  test('inbox with a selected show', async () => {
    const { state, shown } = inbox();
    history.replaceState(null, '', `#${shown}`);
    await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      settings: { ...defaultSettings(), keywords: ['ヨルシカ', '花譜'] },
      inbox: state,
      schedule,
    });
    expect(document.querySelector('#detail h1')?.textContent).toBe(
      'ヨルシカ 公演 2027'
    );
    // The stored note shows in Japanese.
    expect(document.querySelector('#list .update')?.textContent).toBe(
      fakeI18n('ja').getMessage('updateAlsoOn', ['ローチケ'])
    );
    expectJapanese(readable(), 'inbox');
  });

  test('settings with site errors and opt-in sites', async () => {
    await open('ui/options.html', '../extension/src/ui/options.js', {
      settings: { ...defaultSettings(), keywords: ['ヨルシカ'] },
      schedule,
    });
    const text = readable();
    expect(text).toContain(ja.siteBlockedLink.message);
    expect(text).toContain(ja.siteTermsLink.message);
    expectJapanese(text, 'settings');
  });
});
