/**
 * Chrome Web Store listing texts (store/<lang>/description.txt). The store
 * rejected a listing that named the ticket sites as keyword spam ("Yellow
 * Argon"; its troubleshooting page gives "a long list of the sites the
 * extension works on" as the example), so a description names at most two
 * sites as examples, each once; Settings shows the full list.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';
import { ADAPTERS } from '../extension/src/sites/index.js';

const STORE = path.resolve(import.meta.dirname, '../store');

describe.each(['en', 'ja'])('store/%s/description.txt', (lang) => {
  const text = fs.readFileSync(
    path.join(STORE, lang, 'description.txt'),
    'utf-8'
  );

  /** @param {string} name */
  const mentions = (name) => text.split(name).length - 1;

  test('names at most two ticket sites, each at most once', () => {
    const named = ADAPTERS.map((a) => a.name).filter((n) => mentions(n) > 0);
    expect(named.length).toBeLessThanOrEqual(2);
    for (const name of named) expect(mentions(name), name).toBe(1);
  });

  test('fits the store limit of 16,000 characters', () => {
    expect(text.length).toBeLessThanOrEqual(16_000);
  });
});
