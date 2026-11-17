/**
 * chrome.storage.local access. The service worker is the only writer of the
 * inbox and schedule; UI pages send it messages, which keeps writes in one
 * place and in order (see `serial`). Pages read storage directly and listen
 * to `chrome.storage.onChanged`.
 */
import { emptyInbox } from './inbox.js';
import { emptySchedule } from './schedule.js';
import { normalizeSettings } from './settings.js';

/**
 * @typedef {{
 *   get(keys: string[]): Promise<Record<string, any>>,
 *   set(items: Record<string, any>): Promise<void>,
 * }} StorageArea
 */

export const KEYS = /** @type {const} */ ({
  settings: 'settings',
  inbox: 'inbox',
  schedule: 'schedule',
});

/**
 * @param {StorageArea} area
 */
export function createStore(area) {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();

  /**
   * Run `fn` after every earlier call has finished (one writer at a time).
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  const serial = (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };

  const read = async () => {
    const raw = await area.get([KEYS.settings, KEYS.inbox, KEYS.schedule]);
    return {
      settings: normalizeSettings(raw.settings),
      /** @type {import('./inbox.js').InboxState} */
      inbox: { ...emptyInbox(), ...raw.inbox },
      /** @type {import('./schedule.js').ScheduleState} */
      schedule: { ...emptySchedule(), ...raw.schedule },
    };
  };

  /**
   * @template {'settings' | 'inbox' | 'schedule'} K
   * @template R
   * @param {K} key
   * @param {(value: Awaited<ReturnType<typeof read>>[K], all: Awaited<ReturnType<typeof read>>) => { value: Awaited<ReturnType<typeof read>>[K], result?: R }} fn
   * @returns {Promise<R | undefined>}
   */
  const update = (key, fn) =>
    serial(async () => {
      const all = await read();
      const { value, result } = fn(all[key], all);
      await area.set({ [key]: value });
      return result;
    });

  return { read, update, serial };
}
