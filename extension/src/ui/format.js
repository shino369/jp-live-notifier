/**
 * Display formatting shared by the service worker and the pages, in the
 * user's language (lib/i18n.js).
 */
import { t } from '../lib/i18n.js';

/** Short weekday names, Sunday first (read on use: the language may change). */
const weekdays = () => [
  t('weekdaySun'),
  t('weekdayMon'),
  t('weekdayTue'),
  t('weekdayWed'),
  t('weekdayThu'),
  t('weekdayFri'),
  t('weekdaySat'),
];

/** @param {string} iso YYYY-MM-DD */
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = weekdays()[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} (${wd})`;
}

/**
 * `2026/12/05 (Sat) 18:00`, `2026/12/05 (Sat) – 2027/01/10 (Sun)`, or `Date TBA`.
 *
 * @param {string[]} dates
 * @param {string | null} [time]
 */
export function formatDates(dates, time = null) {
  if (dates.length === 0) return t('dateTba');
  const first = formatDate(dates[0]);
  if (dates.length === 1) return time ? `${first} ${time}` : first;
  if (dates.length === 2) return `${first} – ${formatDate(dates[1])}`;
  return `${first} – ${formatDate(dates[dates.length - 1])} · ${t('datesCount', dates.length)}`;
}

/**
 * `just now`, `3 min ago`, `2 h ago`, `5 d ago`, else a date.
 *
 * @param {string} iso
 * @param {number} [now]
 */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return t('agoJustNow');
  if (s < 3600) return t('agoMinutes', Math.floor(s / 60));
  if (s < 86400) return t('agoHours', Math.floor(s / 3600));
  if (s < 86400 * 7) return t('agoDays', Math.floor(s / 86400));
  return iso.slice(0, 10).replaceAll('-', '/');
}

/** A check interval in minutes: `30 min`, `2 h`. @param {number} minutes */
export const formatInterval = (minutes) =>
  minutes < 60
    ? t('intervalMinutes', minutes)
    : t('intervalHours', minutes / 60);
