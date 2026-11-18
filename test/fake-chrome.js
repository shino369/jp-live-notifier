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

/**
 * @param {{ data?: Record<string, any>, replyDelayMs?: number }} [options]
 */
export function fakeChrome({ data = {}, replyDelayMs = 0 } = {}) {
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
    alarms: { get: resolved, create: resolved, onAlarm: ignored() },
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
