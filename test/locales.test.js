/**
 * The extension's chrome.i18n catalogs (extension/_locales) and the manifest
 * fields that read from them. Chrome refuses to load an extension whose
 * manifest names a missing message or whose catalog is malformed, so these
 * checks stand in for loading it.
 */
import fs from 'fs';
import path from 'path';

const EXT = path.join(import.meta.dirname, '..', 'extension');
const LOCALES = path.join(EXT, '_locales');

/**
 * @typedef {{
 *   message: string,
 *   description?: string,
 *   placeholders?: Record<string, { content: string, example?: string }>,
 * }} Message
 */

/** @param {string} file */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const manifest = readJson(path.join(EXT, 'manifest.json'));
const locales = fs.existsSync(LOCALES)
  ? fs
      .readdirSync(LOCALES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

/** @param {string} locale @returns {Record<string, Message>} */
const catalog = (locale) =>
  readJson(path.join(LOCALES, locale, 'messages.json'));

/** `$name$` references in a message (`$$` is a literal dollar sign). */
const refs = (/** @type {string} */ message) =>
  [...message.replaceAll('$$', '').matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) =>
    m[1].toLowerCase()
  );

/** `__MSG_name__` references anywhere in the manifest. */
const manifestRefs = [
  ...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g),
].map((m) => m[1]);

/**
 * The manifest strings as a locale shows them.
 *
 * @param {Record<string, Message>} messages
 * @param {string} value
 */
const resolve = (messages, value) =>
  value.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (_, key) => {
    const entry = Object.entries(messages).find(
      ([k]) => k.toLowerCase() === key.toLowerCase()
    );
    return entry ? entry[1].message : '';
  });

describe('locales', () => {
  test('the manifest sets default_locale to English, and its catalog exists', () => {
    expect(manifest.default_locale).toBe('en');
    expect(locales).toContain('en');
  });

  test('the name, description, and toolbar title come from the catalog', () => {
    expect(manifest.name).toBe('__MSG_appName__');
    expect(manifest.description).toBe('__MSG_appDescription__');
    expect(manifest.action.default_title).toBe('__MSG_appName__');
    expect(catalog('en').appName.message).toBe('Oshi Live Alert');
  });

  test.each(locales)('%s: every manifest __MSG__ key is defined', (locale) => {
    const keys = Object.keys(catalog(locale)).map((k) => k.toLowerCase());
    for (const ref of manifestRefs) expect(keys).toContain(ref.toLowerCase());
  });

  test.each(locales)(
    '%s: the name and description fit the Web Store limits',
    (locale) => {
      const messages = catalog(locale);
      // Chrome Web Store: name ≤ 75 characters, description ≤ 132.
      expect([...resolve(messages, manifest.name)].length).toBeLessThanOrEqual(
        75
      );
      expect(
        [...resolve(messages, manifest.description)].length
      ).toBeLessThanOrEqual(132);
    }
  );

  test.each(locales)('%s: every entry is well formed', (locale) => {
    const messages = catalog(locale);
    const seen = new Set();
    for (const [key, entry] of Object.entries(messages)) {
      // Names are case-insensitive in Chrome: two that differ only in case collide.
      expect(key).toMatch(/^[A-Za-z0-9_@]+$/);
      expect(key.startsWith('@@')).toBe(false);
      expect(seen.has(key.toLowerCase()), `duplicate ${key}`).toBe(false);
      seen.add(key.toLowerCase());

      expect(typeof entry.message, key).toBe('string');
      expect(entry.message.trim(), key).not.toBe('');

      const used = new Set(refs(entry.message));
      const defined = Object.keys(entry.placeholders ?? {}).map((p) =>
        p.toLowerCase()
      );
      // Every $name$ has a placeholder, and every placeholder is used.
      expect([...used].sort(), key).toEqual([...new Set(defined)].sort());
      for (const p of Object.values(entry.placeholders ?? {}))
        expect(p.content, key).toMatch(/^\$[1-9]$/);
    }
  });

  test('English entries tell the translator what each one is', () => {
    for (const [key, entry] of Object.entries(catalog('en')))
      expect(entry.description?.trim(), key).toBeTruthy();
  });

  test('counted messages come in One/Other pairs (chrome.i18n has no plurals)', () => {
    const keys = Object.keys(catalog('en'));
    for (const key of keys.filter((k) => k.endsWith('One')))
      expect(keys, key).toContain(`${key.slice(0, -3)}Other`);
    for (const key of keys.filter((k) => k.endsWith('Other')))
      expect(keys, key).toContain(`${key.slice(0, -5)}One`);
  });

  test.each(locales.filter((l) => l !== 'en'))(
    '%s: has exactly the English keys, with the same placeholders',
    (locale) => {
      const en = catalog('en');
      const other = catalog(locale);
      expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
      for (const [key, entry] of Object.entries(other)) {
        expect(new Set(refs(entry.message)), key).toEqual(
          new Set(refs(en[key].message))
        );
        // A placeholder maps to the same argument in every language.
        for (const [name, p] of Object.entries(entry.placeholders ?? {}))
          expect(p.content, `${key}.${name}`).toBe(
            en[key].placeholders?.[name]?.content
          );
      }
    }
  );
});
