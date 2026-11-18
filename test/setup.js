/**
 * Every test file: a `chrome.i18n` over the English catalog, for modules
 * that format text (lib/i18n.js) in tests that set up no fake `chrome`.
 * Tests that install a fake `chrome` (fake-chrome.js) bring their own.
 */
import { fakeI18n } from './fake-chrome.js';

/** @type {any} */ (globalThis).chrome ??= { i18n: fakeI18n() };
