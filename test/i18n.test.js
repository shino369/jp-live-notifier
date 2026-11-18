// @vitest-environment jsdom
/**
 * lib/i18n.js against the real catalogs (through the fake chrome.i18n), and
 * a scan of the sources: every message the code asks for exists, and every
 * English message is used somewhere.
 */
import fs from 'fs';
import path from 'path';
import {
  errorText,
  localize,
  note,
  noteText,
  plural,
  t,
} from '../extension/src/lib/i18n.js';
import { blockReason } from '../extension/src/lib/http.js';
import { fakeI18n } from './fake-chrome.js';

const EXT = path.resolve(import.meta.dirname, '../extension');

/** @param {string} dir @returns {string[]} */
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory()
        ? files(path.join(dir, d.name))
        : /\.(js|html)$/.test(d.name)
          ? [path.join(dir, d.name)]
          : []
    );

const en = JSON.parse(
  fs.readFileSync(path.join(EXT, '_locales/en/messages.json'), 'utf8')
);

describe('fake chrome.i18n (stands in for Chrome in the tests)', () => {
  test('substitutes named placeholders, $$, and missing names like Chrome', () => {
    const i18n = fakeI18n();
    expect(i18n.getMessage('artistCountOther', ['4'])).toBe('4 artists');
    expect(i18n.getMessage('ARTISTCOUNTOTHER', '4')).toBe('4 artists');
    expect(i18n.getMessage('notifyUpdate', ['Also on e+', 'A'])).toBe(
      'Also on e+ — A'
    );
    expect(i18n.getMessage('noSuchMessage')).toBe('');
    expect(i18n.getUILanguage()).toBe('en');
  });
});

describe('t and plural', () => {
  test('t fills placeholders and shows the key of a missing message', () => {
    expect(t('appName')).toBe('Oshi Live Alert');
    expect(t('checkingLeft', 5)).toBe('Checking… 5 left');
    expect(t('noSuchMessage')).toBe('noSuchMessage');
  });

  test('plural picks the One or Other message by the count', () => {
    expect(plural('artistCount', 1, 1)).toBe('1 artist');
    expect(plural('artistCount', 0, 0)).toBe('0 artists');
    expect(plural('notifyWatchingCount', 1, 'A', 1)).toBe(
      'A: 1 current listing'
    );
    expect(plural('notifyWatchingCount', 3, 'A', 3)).toBe(
      'A: 3 current listings'
    );
  });
});

describe('update notes', () => {
  test('are stored as a key and arguments and shown in the current language', () => {
    expect(note('updateNewSale', '一般発売')).toEqual({
      key: 'updateNewSale',
      args: ['一般発売'],
    });
    expect(noteText(note('updateAlsoOn', 'ローチケ'))).toBe('Also on ローチケ');
    expect(noteText(null)).toBe(null);
  });

  test('notes stored as text by an older version show as they are', () => {
    expect(noteText('New sale: 一般発売')).toBe('New sale: 一般発売');
  });
});

describe('site errors', () => {
  test('the stored technical texts map to messages; anything else shows as is', () => {
    expect(errorText('HTTP 503')).toBe('HTTP 503');
    expect(
      errorText(/** @type {string} */ (blockReason(202, '', () => null)))
    ).toBe('HTTP 202 (challenge)');
    expect(errorText('challenge page (aws-waf-token)')).toBe(
      'challenge page (aws-waf-token)'
    );
    expect(errorText('not a results page (bot check or site change)')).toBe(
      'not a results page (bot check or site change)'
    );
    expect(errorText('network: Failed to fetch')).toBe(
      'network: Failed to fetch'
    );
    expect(errorText('parse: Unexpected token')).toBe(
      'parse: Unexpected token'
    );
    expect(errorText('offscreen did not answer')).toBe(
      'offscreen did not answer'
    );
  });

  test('in another language, the technical detail is kept', () => {
    const ja = {
      errorHttp: {
        message: 'HTTP $S$ エラー',
        placeholders: { s: { content: '$1' } },
      },
      errorChallenge: { message: 'ボット確認' },
      errorChallengePage: {
        message: '確認ページ（$D$）',
        placeholders: { d: { content: '$1' } },
      },
      errorNotResults: { message: '検索結果ではありません' },
      errorNetwork: {
        message: '通信エラー: $D$',
        placeholders: { d: { content: '$1' } },
      },
      errorParse: {
        message: '読み取りエラー: $D$',
        placeholders: { d: { content: '$1' } },
      },
    };
    const saved = globalThis.chrome;
    /** @type {any} */ (globalThis).chrome = { i18n: fakeI18n(ja) };
    try {
      expect(errorText('HTTP 403')).toBe('HTTP 403 エラー');
      expect(errorText('HTTP 202 (challenge)')).toBe('ボット確認');
      expect(errorText('challenge page (x)')).toBe('確認ページ（x）');
      expect(errorText('not a results page (bot check or site change)')).toBe(
        '検索結果ではありません'
      );
      expect(errorText('network: reset')).toBe('通信エラー: reset');
      expect(errorText('parse: bad')).toBe('読み取りエラー: bad');
    } finally {
      globalThis.chrome = saved;
    }
  });
});

describe('localize', () => {
  test('fills text and attributes from data-i18n* and sets the page language', () => {
    document.documentElement.lang = 'xx';
    document.head.innerHTML = '<title data-i18n="pageTitleInbox">x</title>';
    document.body.innerHTML = `
      <h1 data-i18n="appName">x</h1>
      <button data-i18n-title="checkNow" data-i18n-aria-label="checkNow"></button>
      <input data-i18n-placeholder="searchNotifications">`;
    localize(document);
    expect(document.title).toBe('Oshi Live Alert — Inbox');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe('Oshi Live Alert');
    const button = document.querySelector('button');
    expect(button?.title).toBe('Check now');
    expect(button?.getAttribute('aria-label')).toBe('Check now');
    expect(document.querySelector('input')?.placeholder).toBe(
      'Search notifications'
    );
  });
});

describe('the sources and the English catalog', () => {
  const sources = files(path.join(EXT, 'src')).map((f) => ({
    file: path.relative(EXT, f),
    text: fs.readFileSync(f, 'utf8'),
  }));
  /** Message keys the code asks for, by file. */
  const used = new Map();
  for (const { file, text } of sources) {
    for (const [, key] of text.matchAll(/\b(?:t|note)\(\s*'([A-Za-z0-9_]+)'/g))
      used.set(key, file);
    for (const [, base] of text.matchAll(/\bplural\(\s*'([A-Za-z0-9_]+)'/g)) {
      used.set(`${base}One`, file);
      used.set(`${base}Other`, file);
    }
    for (const [, key] of text.matchAll(
      /\bdata-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g
    ))
      used.set(key, file);
  }
  const manifest = fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8');
  for (const [, key] of manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g))
    used.set(key, 'manifest.json');

  test('every message the code asks for is in the catalog', () => {
    for (const [key, file] of used)
      expect(Object.keys(en), `${key} (${file})`).toContain(key);
  });

  test('every message in the catalog is used', () => {
    for (const key of Object.keys(en))
      expect([...used.keys()], key).toContain(key);
  });

  test('the English text written in the HTML matches the catalog', () => {
    for (const { file, text } of sources.filter((s) =>
      s.file.endsWith('.html')
    )) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      for (const el of doc.querySelectorAll('[data-i18n]')) {
        const key = /** @type {string} */ (el.getAttribute('data-i18n'));
        expect(
          el.textContent?.replace(/\s+/g, ' ').trim(),
          `${file} ${key}`
        ).toBe(en[key]?.message);
      }
      for (const attr of ['title', 'aria-label', 'placeholder'])
        for (const el of doc.querySelectorAll(`[data-i18n-${attr}]`)) {
          const key = /** @type {string} */ (
            el.getAttribute(`data-i18n-${attr}`)
          );
          expect(el.getAttribute(attr), `${file} ${attr} ${key}`).toBe(
            en[key]?.message
          );
        }
    }
  });

  test('no English text is left outside the catalog in the HTML pages', () => {
    // The offscreen document is never shown.
    for (const { file, text } of sources.filter(
      (s) => s.file.endsWith('.html') && !s.file.endsWith('offscreen.html')
    )) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      for (const el of doc.querySelectorAll('*')) {
        if (el.closest('[data-i18n], script, style')) continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent?.trim())
          .join('');
        expect(own, `${file} <${el.tagName.toLowerCase()}>`).toBe('');
        for (const attr of ['title', 'aria-label', 'placeholder'])
          if (el.hasAttribute(attr))
            expect(
              el.hasAttribute(`data-i18n-${attr}`),
              `${file} <${el.tagName.toLowerCase()} ${attr}>`
            ).toBe(true);
      }
    }
  });
});
