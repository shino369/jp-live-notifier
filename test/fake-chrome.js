/**
 * A small in-memory `chrome` for running the real service worker and a real
 * page module together in jsdom: storage with onChanged events, and runtime
 * messages delivered to the worker's onMessage listener. Replies can be
 * delayed to model a busy worker (storage events then arrive first, as they
 * can in Chrome).
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(import.meta.dirname, '../extension/src');
const LOCALES = path.resolve(import.meta.dirname, '../extension/_locales');

/**
 * `chrome.i18n` over a real catalog (a locale under extension/_locales, or a
 * catalog object), with Chrome's rules: case-insensitive names, `$name$`
 * placeholders whose content refers to `$1`…`$9`, `$$` for a dollar sign,
 * and '' for a missing message.
 *
 * @param {string | Record<string, { message: string, placeholders?: Record<string, { content: string }> }>} [source]
 */
export function fakeI18n(source = 'en') {
  const catalog =
    typeof source === 'string'
      ? JSON.parse(
          fs.readFileSync(path.join(LOCALES, source, 'messages.json'), 'utf8')
        )
      : source;
  const byName = new Map(
    Object.entries(catalog).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    /** @param {string} name @param {string | string[]} [subs] */
    getMessage(name, subs = []) {
      const entry = byName.get(name.toLowerCase());
      if (!entry) return '';
      const args = typeof subs === 'string' ? [subs] : subs;
      const fill = (/** @type {string} */ s) =>
        s.replace(/\$([1-9])/g, (_, n) => args[Number(n) - 1] ?? '');
      const holders = new Map(
        Object.entries(entry.placeholders ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v.content,
        ])
      );
      return entry.message.replace(
        /\$\$|\$([A-Za-z0-9_@]+)\$|\$([1-9])/g,
        (
          /** @type {string} */ m,
          /** @type {string} */ name,
          /** @type {string | undefined} */ n
        ) =>
          m === '$$'
            ? '$'
            : n
              ? (args[Number(n) - 1] ?? '')
              : fill(holders.get(name.toLowerCase()) ?? '')
      );
    },
    getUILanguage: () =>
      typeof source === 'string' ? source.replace('_', '-') : 'en',
  };
}

/**
 * @param {{ data?: Record<string, any>, replyDelayMs?: number, locale?: string }} [options]
 *   `locale`: the catalog chrome.i18n reads (a folder in extension/_locales)
 */
export function fakeChrome({
  data = {},
  replyDelayMs = 0,
  locale = 'en',
} = {}) {
  /** @type {Array<(changes: Record<string, any>, area: string) => void>} */
  const changed = [];
  /** @type {Array<(msg: any, sender: unknown, reply: (r: unknown) => void) => unknown>} */
  const messages = [];
  /** @type {any[]} messages sent through runtime.sendMessage */
  const sent = [];
  const stored = structuredClone(data);
  /** @param {any[]} list */
  const event = (list) => ({
    addListener: (/** @type {any} */ fn) => list.push(fn),
  });
  const ignored = () => event([]);
  const resolved = async () => undefined;

  const chrome = {
    i18n: fakeI18n(locale),
    storage: {
      local: {
        get: async (/** @type {string | string[]} */ keys) =>
          Object.fromEntries(
            (typeof keys === 'string' ? [keys] : keys)
              .filter((k) => k in stored)
              .map((k) => [k, structuredClone(stored[k])])
          ),
        getKeys: async () => Object.keys(stored),
        remove: async (/** @type {string | string[]} */ keys) => {
          /** @type {Record<string, any>} */
          const changes = {};
          for (const k of typeof keys === 'string' ? [keys] : keys) {
            if (!(k in stored)) continue;
            changes[k] = { oldValue: stored[k] };
            delete stored[k];
          }
          if (Object.keys(changes).length === 0) return;
          for (const fn of changed) fn(changes, 'local');
        },
        set: async (/** @type {Record<string, any>} */ items) => {
          /** @type {Record<string, any>} */
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            // Like Chrome: writing an equal value fires no change event.
            if (JSON.stringify(stored[k]) === JSON.stringify(v)) continue;
            changes[k] = { oldValue: stored[k], newValue: structuredClone(v) };
            stored[k] = structuredClone(v);
          }
          if (Object.keys(changes).length === 0) return;
          for (const fn of changed) fn(changes, 'local');
        },
      },
      onChanged: event(changed),
    },
    runtime: {
      getURL: (/** @type {string} */ p) => `chrome-extension://test/${p}`,
      onMessage: event(messages),
      onInstalled: ignored(),
      onStartup: ignored(),
      getContexts: async () => [],
      openOptionsPage: resolved,
      sendMessage: (/** @type {any} */ msg) => {
        sent.push(structuredClone(msg));
        return new Promise((resolve) => {
          for (const fn of messages)
            fn(msg, {}, (r) => setTimeout(() => resolve(r), replyDelayMs));
        });
      },
    },
    alarms: {
      get: resolved,
      create: resolved,
      clear: resolved,
      onAlarm: ignored(),
    },
    idle: { queryState: async () => 'active', onStateChanged: ignored() },
    notifications: {
      create: resolved,
      clear: resolved,
      onClicked: ignored(),
    },
    action: { setBadgeText: resolved, setBadgeBackgroundColor: resolved },
    tabs: { create: resolved, update: resolved, remove: resolved },
    windows: { update: resolved },
  };
  return { chrome, stored, sent };
}

/**
 * Put a page's body markup into the jsdom document (its scripts do not run;
 * the test imports the page module itself).
 *
 * @param {string} page e.g. 'ui/options.html'
 */
export function loadPage(page) {
  const html = fs.readFileSync(path.join(SRC, page), 'utf-8');
  document.body.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html'
  ).body.innerHTML;
}

/** Let pending messages, storage events, and renders finish. */
export const settle = (ms = 80) =>
  new Promise((resolve) => setTimeout(resolve, ms));
