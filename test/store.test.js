/**
 * Chrome Web Store listing texts (store/<lang>/description.txt). The store
 * rejected a listing that named the ticket sites twice as keyword spam
 * ("Yellow Argon"), so each site name may appear once per description.
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

  test.each(ADAPTERS.map((a) => a.name))('names %s exactly once', (name) => {
    expect(text.split(name).length - 1).toBe(1);
  });

  test('fits the store limit of 16,000 characters', () => {
    expect(text.length).toBeLessThanOrEqual(16_000);
  });
});
