/**
 * The inbox: concerts (one notification each, grouping listings from several
 * sites), the seen index that stops a listing from alerting twice, and
 * tombstones that stop a deleted concert from coming back through another
 * site. Every function here is pure: it takes an InboxState and returns a new
 * one.
 */
import { clean, fold, hash, mentions, similarity } from './text.js';

/**
 * @typedef {{
 *   site: string,
 *   siteId: string,
 *   url: string,
 *   title: string,
 *   performers: string[],
 *   venue: string | null,
 *   prefecture: string | null,
 *   dates: string[],
 *   time: string | null,
 *   saleLabel: string | null,
 *   saleStart: string | null,
 *   saleEnd: string | null,
 *   image: string | null,
 *   posterChecked?: boolean,
 * }} Listing  one item as a ticket site lists it; `posterChecked`: its
 *   page was read for a poster (lib/poster.js)
 *
 * @typedef {Listing & { firstSeenAt: string, lastSeenAt: string }} Offer
 *
 * @typedef {{
 *   id: string,
 *   keywords: string[],
 *   title: string,
 *   performers: string[],
 *   venue: string | null,
 *   prefecture: string | null,
 *   dates: string[],
 *   time: string | null,
 *   image: string | null,
 *   offers: Offer[],
 *   createdAt: string,
 *   updatedAt: string,
 *   read: boolean,
 *   starred: boolean,
 *   update: string | null,
 * }} Concert
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   venue: string | null,
 *   dates: string[],
 *   time?: string | null,
 *   performers?: string[],
 *   keywords?: string[],
 * }} Tombstone  time, performers, and keywords are missing in older ones
 *
 * @typedef {{
 *   concerts: Record<string, Concert>,
 *   seen: Record<string, { concertId: string, lastSeenAt: string }>,
 *   tombstones: Tombstone[],
 * }} InboxState
 */

/** @returns {InboxState} */
export const emptyInbox = () => ({ concerts: {}, seen: {}, tombstones: [] });

/** @param {Pick<Listing, 'site' | 'siteId'>} l */
export const listingKey = (l) => `${l.site}:${l.siteId}`;

/**
 * @param {string[]} dates
 * @returns {[string, string] | null}
 */
const span = (dates) =>
  dates.length ? [dates[0], dates[dates.length - 1]] : null;

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean | null} null when either side has no dates
 */
function datesOverlap(a, b) {
  const x = span(a);
  const y = span(b);
  if (!x || !y) return null;
  return x[0] <= y[1] && y[0] <= x[1];
}

/**
 * @typedef {Pick<Listing, 'title' | 'venue' | 'dates'> & {
 *   time?: string | null,
 *   performers?: string[],
 *   keywords?: string[],
 * }} ShowLike  a concert, or a tombstone (older ones lack the optional fields)
 */

/**
 * Whether the listing is by the show's artist: a performer or keyword of one
 * side matches one of the other, or is named in the other's title. With no
 * artist known on one side, the titles must be similar.
 *
 * @param {Pick<Listing, 'title' | 'performers'>} listing
 * @param {ShowLike} show
 * @param {string | undefined} keyword
 */
function sameArtist(listing, show, keyword) {
  const mine = [...listing.performers, ...(keyword ? [keyword] : [])];
  const theirs = [...(show.performers ?? []), ...(show.keywords ?? [])];
  if (mine.length === 0 || theirs.length === 0)
    return similarity(listing.title, show.title) >= 0.5;
  return (
    mine.some((a) => theirs.some((b) => similarity(a, b) >= 0.8)) ||
    theirs.some((b) => mentions(b, [listing.title])) ||
    mine.some((a) => mentions(a, [show.title]))
  );
}

/**
 * Whether a listing is the same show as a concert (or a tombstone).
 *
 * - Dates must overlap; without dates on one side, only a near-identical
 *   title counts.
 * - Both sides must name the same artist (see `sameArtist`), and when both
 *   give a performance time, the times must be equal (a matinee and an
 *   evening show are two concerts).
 * - Then the venue must be similar, or (when a venue is missing) the title.
 *
 * @param {Pick<Listing, 'title' | 'venue' | 'dates' | 'time' | 'performers'>} listing
 * @param {ShowLike} concert
 * @param {string} [keyword] the keyword the listing was found for
 * @returns {boolean}
 */
export function sameShow(listing, concert, keyword) {
  const overlap = datesOverlap(listing.dates, concert.dates);
  const titleSim = similarity(listing.title, concert.title);
  if (overlap === false) return false;
  if (listing.time && concert.time && listing.time !== concert.time)
    return false;
  if (!sameArtist(listing, concert, keyword)) return false;
  if (overlap === null) return titleSim >= 0.85;
  if (listing.venue && concert.venue) {
    return similarity(listing.venue, concert.venue) >= 0.5 || titleSim >= 0.8;
  }
  return titleSim >= 0.5;
}

/**
 * The concert with these offers, its facts derived from them: every offer's
 * dates and performers, and the first offer's venue, prefecture, time, and
 * image (the next offer's when one is missing). Deriving them on every change
 * keeps the concert current when a site moves a show to another date or venue.
 *
 * @param {Concert} c
 * @param {Offer[]} offers
 * @returns {Concert}
 */
function withOffers(c, offers) {
  const first = (/** @type {'venue' | 'prefecture' | 'time' | 'image'} */ k) =>
    offers.find((o) => o[k])?.[k] ?? null;
  return {
    ...c,
    offers,
    dates: [...new Set(offers.flatMap((o) => o.dates))].sort(),
    venue: first('venue'),
    prefecture: first('prefecture'),
    time: first('time'),
    image: first('image'),
    performers: [...new Set(offers.flatMap((o) => o.performers))],
  };
}

/**
 * Sale labels that end a sale rather than open one (sites report a status
 * such as 販売中 → 売切 under the same listing).
 */
const CLOSED_SALE =
  /売切|売り切れ|完売|終了|締切|中止|延期|休止|sold\s*out|closed|ended/i;

/**
 * Whether a refreshed listing opens a sale its offer did not have: a new
 * label that is not a closing status, or, under the same open label, a new
 * sale start (another reception opened).
 *
 * @param {Listing} listing
 * @param {Offer | undefined} before
 */
function opensSale(listing, before) {
  const label = listing.saleLabel;
  if (!label || CLOSED_SALE.test(label)) return false;
  if (label !== before?.saleLabel) return true;
  return Boolean(
    listing.saleStart &&
    before?.saleStart &&
    listing.saleStart !== before.saleStart
  );
}

/**
 * @param {Listing} l
 * @param {string} now
 * @returns {Offer}
 */
const toOffer = (l, now) => ({ ...l, firstSeenAt: now, lastSeenAt: now });

/**
 * Add listings found for `keyword` to the inbox.
 *
 * - A listing already in the seen index refreshes its offer; when it opens
 *   a new sale (see `opensSale`), a read concert turns unread with a
 *   "New sale" `update` note.
 * - A new listing joins a concert it matches (adding an offer; a concert
 *   already read turns unread with an `update` note), is dropped silently when it
 *   matches a tombstone, or starts a new concert.
 * - With `baseline` (first sync of a keyword), new concerts arrive unread
 *   but are not `updated`, and joining a read one does not mark it unread;
 *   the caller sends one summary instead of a notification per concert.
 *
 * @param {InboxState} state
 * @param {{ keyword: string, listings: Listing[], now: string, baseline?: boolean, siteNames?: Record<string, string> }} input
 * @returns {{ state: InboxState, created: string[], updated: string[] }}
 */
export function ingest(
  state,
  { keyword, listings, now, baseline = false, siteNames = {} }
) {
  const concerts = { ...state.concerts };
  const seen = { ...state.seen };
  /** @type {Set<string>} */
  const created = new Set();
  /** @type {Set<string>} */
  const updated = new Set();

  for (const listing of listings) {
    const key = listingKey(listing);
    const known = seen[key];
    if (known) {
      seen[key] = { ...known, lastSeenAt: now };
      const c = concerts[known.concertId];
      if (c) {
        // A site can open a new sale phase (e.g. general sale after the
        // presale) under the same listing: that is news for a read concert.
        const before = c.offers.find((o) => listingKey(o) === key);
        const newSale = opensSale(listing, before);
        const isUpdate = newSale && !baseline && c.read;
        const refreshed = withOffers(
          c,
          c.offers.map((o) =>
            listingKey(o) === key
              ? {
                  ...o,
                  ...listing,
                  // A search result without an image keeps the poster
                  // found earlier (lib/poster.js).
                  image: listing.image ?? o.image,
                  posterChecked: listing.posterChecked ?? o.posterChecked,
                  firstSeenAt: o.firstSeenAt,
                  lastSeenAt: now,
                }
              : o
          )
        );
        concerts[c.id] = {
          ...refreshed,
          keywords: c.keywords.includes(keyword)
            ? c.keywords
            : [...c.keywords, keyword],
          ...(isUpdate && {
            updatedAt: now,
            read: false,
            update: `New sale: ${listing.saleLabel}`,
          }),
        };
        if (isUpdate) updated.add(c.id);
      }
      continue;
    }

    const tomb = state.tombstones.find((t) => sameShow(listing, t, keyword));
    if (tomb) {
      seen[key] = { concertId: tomb.id, lastSeenAt: now };
      continue;
    }

    const match = Object.values(concerts).find((c) =>
      sameShow(listing, c, keyword)
    );
    if (match) {
      const isNewSite = !match.offers.some((o) => o.site === listing.site);
      const merged = withOffers(match, [
        ...match.offers,
        toOffer(listing, now),
      ]);
      const note = isNewSite
        ? `Also on ${siteNames[listing.site] ?? listing.site}`
        : `New sale: ${listing.saleLabel ?? listing.title}`;
      // Only a concert the user has already read becomes an "update"; an
      // unread one is still news on its own.
      const isUpdate = !baseline && match.read;
      concerts[match.id] = {
        ...merged,
        keywords: match.keywords.includes(keyword)
          ? match.keywords
          : [...match.keywords, keyword],
        updatedAt: now,
        read: isUpdate ? false : match.read,
        update: isUpdate ? note : match.update,
      };
      if (isUpdate) updated.add(match.id);
      seen[key] = { concertId: match.id, lastSeenAt: now };
      continue;
    }

    const id = hash(`${key}|${fold(listing.title)}`);
    concerts[id] = {
      id,
      keywords: [keyword],
      title: clean(listing.title),
      performers: listing.performers,
      venue: listing.venue,
      prefecture: listing.prefecture,
      dates: listing.dates,
      time: listing.time,
      image: listing.image,
      offers: [toOffer(listing, now)],
      createdAt: now,
      updatedAt: now,
      // Unread even in a baseline: the user has not seen it yet. The first
      // sync stays quiet through notifications (one summary), not the inbox.
      read: false,
      starred: false,
      update: null,
    };
    created.add(id);
    seen[key] = { concertId: id, lastSeenAt: now };
  }

  return {
    state: { ...state, concerts, seen },
    created: [...created],
    updated: [...updated],
  };
}

/**
 * @param {InboxState} state
 * @param {string} id
 * @param {(c: Concert) => Concert} fn
 * @returns {InboxState}
 */
function patch(state, id, fn) {
  const c = state.concerts[id];
  if (!c) return state;
  return { ...state, concerts: { ...state.concerts, [id]: fn(c) } };
}

/** @param {InboxState} s @param {string} id @param {boolean} [read] */
export const markRead = (s, id, read = true) =>
  patch(s, id, (c) => ({ ...c, read, update: read ? null : c.update }));

/** @param {InboxState} s */
export const markAllRead = (s) => ({
  ...s,
  concerts: Object.fromEntries(
    Object.entries(s.concerts).map(([id, c]) => [
      id,
      { ...c, read: true, update: null },
    ])
  ),
});

/** @param {InboxState} s @param {string} id @param {boolean} [starred] */
export const setStarred = (s, id, starred) =>
  patch(s, id, (c) => ({ ...c, starred: starred ?? !c.starred }));

/**
 * Delete concerts, leaving tombstones so later listings of the same show are
 * not announced again.
 *
 * @param {InboxState} state
 * @param {string[]} ids
 * @returns {InboxState}
 */
export function remove(state, ids) {
  const concerts = { ...state.concerts };
  const tombstones = [...state.tombstones];
  for (const id of ids) {
    const c = concerts[id];
    if (!c) continue;
    tombstones.push({
      id,
      title: c.title,
      venue: c.venue,
      dates: c.dates,
      time: c.time,
      performers: c.performers,
      keywords: c.keywords,
    });
    delete concerts[id];
  }
  return { ...state, concerts, tombstones };
}

/**
 * Ids "Clear all" removes: read and not starred.
 *
 * @param {InboxState} state
 * @returns {string[]}
 */
export const clearableIds = (state) =>
  Object.values(state.concerts)
    .filter((c) => c.read && !c.starred)
    .map((c) => c.id);

/**
 * Drop what can no longer matter: unstarred concerts whose last date is more
 * than `keepDays` ago (they stay in the seen index), tombstones of past shows,
 * and seen entries not seen for `seenDays`.
 *
 * @param {InboxState} state
 * @param {{ today: string, keepDays?: number, seenDays?: number }} options today as YYYY-MM-DD
 * @returns {InboxState}
 */
export function prune(state, { today, keepDays = 7, seenDays = 180 }) {
  const day = (/** @type {number} */ n) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const keepAfter = day(keepDays);
  const seenAfter = day(seenDays);
  const past = (/** @type {string[]} */ dates) =>
    dates.length > 0 && dates[dates.length - 1] < keepAfter;
  return {
    concerts: Object.fromEntries(
      Object.entries(state.concerts).filter(
        ([, c]) => c.starred || !past(c.dates)
      )
    ),
    seen: Object.fromEntries(
      Object.entries(state.seen).filter(
        ([, v]) => v.lastSeenAt.slice(0, 10) >= seenAfter
      )
    ),
    tombstones: state.tombstones.filter((t) => !past(t.dates)),
  };
}

/**
 * Concerts newest first (by updatedAt, then first date).
 *
 * @param {InboxState} state
 * @param {'all' | 'unread' | 'starred'} [filter]
 * @returns {Concert[]}
 */
export function list(state, filter = 'all') {
  return Object.values(state.concerts)
    .filter((c) =>
      filter === 'unread' ? !c.read : filter === 'starred' ? c.starred : true
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        (a.dates[0] ?? '').localeCompare(b.dates[0] ?? '')
    );
}

/** @param {InboxState} state */
export const unreadCount = (state) =>
  Object.values(state.concerts).filter((c) => !c.read).length;
