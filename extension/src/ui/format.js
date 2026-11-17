/**
 * Display formatting shared by the service worker and the pages.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** @param {string} iso YYYY-MM-DD */
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} (${wd})`;
}

/**
 * `2026/12/05 (Sat) 18:00`, `2026/12/05 (Sat) – 2027/01/10 (Sun)`, or `Date TBA`.
 *
 * @param {string[]} dates
 * @param {string | null} [time]
 */
export function formatDates(dates, time = null) {
  if (dates.length === 0) return 'Date TBA';
  const first = formatDate(dates[0]);
  if (dates.length === 1) return time ? `${first} ${time}` : first;
  if (dates.length === 2) return `${first} – ${formatDate(dates[1])}`;
  return `${first} – ${formatDate(dates[dates.length - 1])} · ${dates.length} dates`;
}

/**
 * `just now`, `3 min ago`, `2 h ago`, `5 d ago`, else a date.
 *
 * @param {string} iso
 * @param {number} [now]
 */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return iso.slice(0, 10).replaceAll('-', '/');
}
