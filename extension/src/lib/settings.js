/**
 * User settings: the keyword list, the polling interval, enabled sites, and
 * notification switches.
 */
import { clean, fold } from './text.js';

/**
 * @typedef {{
 *   keywords: string[],
 *   intervalMinutes: number,
 *   sites: Record<string, boolean>,
 *   notify: boolean,
 *   notifyUpdates: boolean,
 *   ticketReminderHours: number,
 *   tabFallback: boolean,
 * }} Settings
 *
 * `tabFallback`: when a site answers with a bot challenge, load its search
 * page in a background tab (a real page load solves the challenge) and read
 * the results from there.
 */

export const INTERVALS = [30, 60, 180, 360, 720];
export const TICKET_REMINDER_HOURS = [0, 1, 2, 3, 6, 12];

/** @returns {Settings} */
export const defaultSettings = () => ({
  keywords: [],
  intervalMinutes: 60,
  sites: {},
  notify: true,
  notifyUpdates: false,
  ticketReminderHours: 3,
  tabFallback: false,
});

/**
 * Split pasted text into keywords: one per line (or per tab, for cells
 * pasted from a spreadsheet), trimmed, without blanks or duplicates (compared
 * folded, keeping the first spelling). Commas and 、 are part of a name
 * (`Earth, Wind & Fire`), never separators.
 *
 * @param {string} text
 * @param {string[]} [existing] keywords already in the list
 * @returns {{ added: string[], duplicates: string[] }}
 */
export function splitKeywords(text, existing = []) {
  const taken = new Set(existing.map(fold));
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const duplicates = [];
  for (const raw of text.split(/[\n\r\t]+/)) {
    const keyword = clean(raw);
    if (!keyword) continue;
    const key = fold(keyword);
    if (!key) continue;
    if (taken.has(key)) {
      duplicates.push(keyword);
      continue;
    }
    taken.add(key);
    added.push(keyword);
  }
  return { added, duplicates };
}

/**
 * Fill in defaults and drop invalid values from stored settings.
 *
 * @param {unknown} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const keywords = Array.isArray(r.keywords)
    ? splitKeywords(r.keywords.filter((k) => typeof k === 'string').join('\n'))
        .added
    : base.keywords;
  const interval = Number(r.intervalMinutes);
  const reminder = r.ticketReminderHours;
  const sites =
    r.sites && typeof r.sites === 'object'
      ? Object.fromEntries(
          Object.entries(r.sites).filter(([, v]) => typeof v === 'boolean')
        )
      : {};
  return {
    keywords,
    intervalMinutes: INTERVALS.includes(interval)
      ? interval
      : base.intervalMinutes,
    sites,
    notify: typeof r.notify === 'boolean' ? r.notify : base.notify,
    notifyUpdates:
      typeof r.notifyUpdates === 'boolean'
        ? r.notifyUpdates
        : base.notifyUpdates,
    ticketReminderHours:
      typeof reminder === 'number' && TICKET_REMINDER_HOURS.includes(reminder)
        ? reminder
        : base.ticketReminderHours,
    tabFallback:
      typeof r.tabFallback === 'boolean' ? r.tabFallback : base.tabFallback,
  };
}

/**
 * One edit from the settings page. Pages send edits, not whole settings, and
 * the service worker applies each one to the settings stored at that moment,
 * so two quick edits never overwrite each other.
 *
 * @typedef {{ type: 'set', key: 'notify' | 'notifyUpdates' | 'tabFallback', value: boolean }
 *   | { type: 'set', key: 'intervalMinutes' | 'ticketReminderHours', value: number }
 *   | { type: 'site', site: string, on: boolean }
 *   | { type: 'addKeywords', keywords: string[] }
 *   | { type: 'removeKeyword', keyword: string }
 *   | { type: 'renameKeyword', from: string, to: string }} SettingsChange
 */

/**
 * Apply one edit. A rename or removal of a keyword that is no longer in the
 * list changes nothing; added keywords already in the list are skipped.
 *
 * @param {Settings} settings
 * @param {SettingsChange} change
 * @returns {Settings}
 */
export function applySettingsChange(settings, change) {
  switch (change.type) {
    case 'set':
      return { ...settings, [change.key]: change.value };
    case 'site':
      return {
        ...settings,
        sites: { ...settings.sites, [change.site]: change.on },
      };
    case 'addKeywords': {
      const { added } = splitKeywords(
        change.keywords.join('\n'),
        settings.keywords
      );
      return { ...settings, keywords: [...settings.keywords, ...added] };
    }
    case 'removeKeyword':
      return {
        ...settings,
        keywords: settings.keywords.filter((k) => k !== change.keyword),
      };
    case 'renameKeyword': {
      const i = settings.keywords.indexOf(change.from);
      if (i === -1) return settings;
      const others = settings.keywords.filter((_, j) => j !== i);
      const [to] = splitKeywords(change.to, others).added;
      if (!to) return settings;
      return {
        ...settings,
        keywords: [...others.slice(0, i), to, ...others.slice(i)],
      };
    }
  }
}

/**
 * Whether a site is on: the user's choice, else the site's default.
 *
 * @param {Settings} settings
 * @param {string} site
 * @param {boolean} [defaultOn]
 */
export const siteEnabled = (settings, site, defaultOn = true) =>
  settings.sites[site] ?? defaultOn;
