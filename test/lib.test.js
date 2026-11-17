import {
  clean,
  fold,
  hash,
  mentions,
  parseDates,
  parseTime,
  similarity,
} from '../extension/src/lib/text.js';
import {
  clearableIds,
  emptyInbox,
  ingest,
  list,
  markAllRead,
  markRead,
  prune,
  remove,
  sameShow,
  setStarred,
  unreadCount,
} from '../extension/src/lib/inbox.js';
import {
  applySettingsChange,
  defaultSettings,
  normalizeSettings,
  siteEnabled,
  splitKeywords,
} from '../extension/src/lib/settings.js';
import {
  emptySchedule,
  enqueueRound,
  finishJob,
  isBaseline,
  pickJob,
  retain,
  startJob,
} from '../extension/src/lib/schedule.js';

const REF = new Date(2026, 10, 17);
const NOW = '2026-11-17T09:00:00.000Z';

/** @param {Partial<import('../extension/src/lib/inbox.js').Listing>} over */
const listing = (over = {}) => ({
  site: 'eplus',
  siteId: '1',
  url: 'https://eplus.jp/x',
  title: 'ヨルシカ LIVE TOUR 2026「盗作」',
  performers: ['ヨルシカ'],
  venue: '日本武道館',
  prefecture: '東京都',
  dates: ['2026-12-05'],
  time: '18:00',
  saleLabel: 'プレオーダー',
  saleStart: null,
  saleEnd: null,
  image: null,
  ...over,
});

describe('text', () => {
  test('fold normalizes width, case, kana, and punctuation', () => {
    expect(fold('ＢＵＭＰ　OF chicken')).toBe('bumpofchicken');
    expect(fold('よるしか')).toBe(fold('ヨルシカ'));
    expect(fold('back・number!')).toBe('backnumber');
    expect(fold(null)).toBe('');
    expect(clean('  a \n　b ')).toBe('a b');
    expect(clean(undefined)).toBe('');
  });

  test('similarity and mentions', () => {
    expect(similarity('日本武道館', '日本武道館')).toBe(1);
    expect(similarity('東京 日本武道館', '日本武道館')).toBe(1);
    expect(
      similarity('横浜アリーナ', 'さいたまスーパーアリーナ')
    ).toBeGreaterThan(0.2);
    expect(similarity('横浜アリーナ', 'Zepp Haneda')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
    expect(similarity('a', 'ab')).toBe(1);
    expect(similarity('ab', 'cd')).toBe(0);
    expect(mentions('back number', ['BACK NUMBER tour'])).toBe(true);
    expect(mentions('花譜', ['ヨルシカ', null])).toBe(false);
    expect(mentions(' ', ['x'])).toBe(false);
  });

  test('parseDates reads Japanese formats and infers the year', () => {
    expect(parseDates('2026/12/05(土) 18:00', REF)).toEqual(['2026-12-05']);
    expect(parseDates('2026年12月5日（土）～2027年1月10日（日）', REF)).toEqual(
      ['2026-12-05', '2027-01-10']
    );
    expect(parseDates('12/5(土)', REF)).toEqual(['2026-12-05']);
    expect(parseDates('1/10(日)', REF)).toEqual(['2027-01-10']);
    expect(parseDates('2026.12.05 / 12.06', REF)).toEqual([
      '2026-12-05',
      '2026-12-06',
    ]);
    expect(parseDates('2026/02/30', REF)).toEqual([]);
    expect(parseDates(null, REF)).toEqual([]);
    expect(parseTime('OPEN 17:00 / START １８：００')).toBe('17:00');
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('none')).toBeNull();
    expect(hash('a')).toMatch(/^[0-9a-z]+$/);
    expect(hash('a')).not.toBe(hash('b'));
  });
});

describe('inbox', () => {
  test('sameShow uses dates, then venue or title', () => {
    const c = listing();
    expect(sameShow(listing({ venue: '武道館' }), c)).toBe(true);
    expect(sameShow(listing({ dates: ['2026-12-06'] }), c)).toBe(false);
    expect(sameShow(listing({ venue: 'Zepp Haneda', title: 'other' }), c)).toBe(
      false
    );
    expect(sameShow(listing({ venue: 'Zepp Haneda' }), c)).toBe(true);
    expect(
      sameShow(listing({ venue: null, title: 'ヨルシカ LIVE TOUR 2026' }), c)
    ).toBe(true);
    expect(sameShow(listing({ dates: [] }), c)).toBe(true);
    expect(sameShow(listing({ dates: [], title: 'ヨルシカ 別公演' }), c)).toBe(
      false
    );
  });

  test('sameShow keeps apart other artists and other performance times', () => {
    const c = listing({ time: '11:00' });
    expect(
      sameShow(listing({ title: '花譜 単独公演', performers: ['花譜'] }), c)
    ).toBe(false);
    expect(sameShow(listing({ time: '19:00' }), c)).toBe(false);
    expect(sameShow(listing({ time: null, venue: '武道館' }), c)).toBe(true);
    // A joint show: the other artist is named in the concert's title.
    expect(
      sameShow(
        listing({ title: '花譜', performers: ['花譜'] }),
        listing({ title: 'ヨルシカ × 花譜', performers: ['ヨルシカ'] })
      )
    ).toBe(true);
    // Keywords count as the show's artists.
    expect(
      sameShow(
        listing({ title: 'x', performers: [] }),
        { ...listing({ title: 'y', performers: [] }), keywords: ['k'] },
        'k'
      )
    ).toBe(true);
    // Without artists on one side, the titles decide.
    expect(sameShow(listing({ performers: [], time: null }), c)).toBe(true);
    expect(
      sameShow(listing({ performers: [], time: null, title: 'other' }), c)
    ).toBe(false);
  });

  test('a different artist at the same venue and date is a new concert', () => {
    const a = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing({ time: '11:00' })],
      now: NOW,
    });
    const b = listing({
      site: 'pia',
      siteId: 'b1',
      title: '花譜 単独公演',
      performers: ['花譜'],
      time: '19:00',
    });
    const r = ingest(a.state, { keyword: '花譜', listings: [b], now: NOW });
    expect(r.created).toHaveLength(1);
    expect(r.state.concerts[a.created[0]].offers).toHaveLength(1);

    // Deleting A first must not swallow B through A's tombstone.
    const gone = remove(a.state, a.created);
    expect(gone.tombstones[0]).toMatchObject({
      performers: ['ヨルシカ'],
      keywords: ['ヨルシカ'],
      time: '11:00',
    });
    const after = ingest(gone, { keyword: '花譜', listings: [b], now: NOW });
    expect(after.created).toHaveLength(1);
    // The same performance at another time is a separate concert as well.
    const later = ingest(a.state, {
      keyword: 'ヨルシカ',
      listings: [listing({ site: 'pia', siteId: 'p2', time: '19:00' })],
      now: NOW,
    });
    expect(later.created).toHaveLength(1);
  });

  test('a tombstone saved without artists still matches by title', () => {
    const old = {
      ...emptyInbox(),
      tombstones: [
        {
          id: 't',
          title: 'ヨルシカ LIVE TOUR 2026「盗作」',
          venue: '日本武道館',
          dates: ['2026-12-05'],
        },
      ],
    };
    expect(
      ingest(old, { keyword: 'ヨルシカ', listings: [listing()], now: NOW })
        .created
    ).toEqual([]);
    expect(
      ingest(old, {
        keyword: '花譜',
        listings: [listing({ title: '花譜 単独公演', performers: ['花譜'] })],
        now: NOW,
      }).created
    ).toHaveLength(1);
  });

  test('ingest creates, groups across sites, and skips seen listings', () => {
    let r = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing()],
      now: NOW,
    });
    expect(r.created).toHaveLength(1);
    const id = r.created[0];
    expect(r.state.concerts[id]).toMatchObject({
      read: false,
      starred: false,
      keywords: ['ヨルシカ'],
    });

    const unseen = ingest(r.state, {
      keyword: 'ヨルシカ',
      listings: [listing({ site: 'ltike', siteId: 'L0' })],
      now: NOW,
    });
    expect(unseen).toMatchObject({ created: [], updated: [] });
    expect(unseen.state.concerts[id]).toMatchObject({
      read: false,
      update: null,
    });

    r = ingest(markRead(r.state, id), {
      keyword: 'ヨルシカ',
      listings: [
        listing({
          site: 'pia',
          siteId: 'p9',
          venue: '日本武道館(東京都)',
          time: null,
        }),
      ],
      now: '2026-11-17T10:00:00.000Z',
      siteNames: { pia: 'チケットぴあ' },
    });
    expect(r).toMatchObject({ created: [], updated: [id] });
    const c = r.state.concerts[id];
    expect(c.offers.map((o) => o.site)).toEqual(['eplus', 'pia']);
    expect(c).toMatchObject({ read: false, update: 'Also on チケットぴあ' });

    const read = markRead(r.state, id);
    r = ingest(read, {
      keyword: 'ヨルシカ',
      listings: [listing({ siteId: '2', saleLabel: '一般発売' })],
      now: NOW,
    });
    expect(r.state.concerts[id].update).toBe('New sale: 一般発売');
    r = ingest(markRead(r.state, id), {
      keyword: 'ヨルシカ',
      listings: [listing({ siteId: '3', saleLabel: null })],
      now: NOW,
    });
    expect(r.state.concerts[id].update).toMatch(/^New sale: ヨルシカ/);

    const again = ingest(markRead(r.state, id), {
      keyword: '盗作',
      listings: [listing({ title: 'renamed' })],
      now: '2026-11-18T00:00:00.000Z',
    });
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.state.concerts[id].read).toBe(true);
    expect(again.state.concerts[id].keywords).toEqual(['ヨルシカ', '盗作']);
    expect(again.state.concerts[id].offers[0]).toMatchObject({
      title: 'renamed',
      firstSeenAt: NOW,
    });
    const same = ingest(again.state, {
      keyword: '盗作',
      listings: [listing()],
      now: NOW,
    });
    expect(same.state.concerts[id].keywords).toEqual(['ヨルシカ', '盗作']);
  });

  test('ingest groups within one batch; baseline concerts arrive unread without notes', () => {
    const r = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [
        listing(),
        listing({ site: 'ltike', siteId: 'L1' }),
        listing({ siteId: '5', dates: ['2026-12-20'], venue: '大阪城ホール' }),
      ],
      now: NOW,
      baseline: true,
    });
    expect(r.created).toHaveLength(2);
    expect(r.updated).toEqual([]);
    expect(
      Object.values(r.state.concerts).every((c) => !c.read && c.update === null)
    ).toBe(true);
    const fresh = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [
        listing(),
        listing({
          site: 'ltike',
          siteId: 'L1',
          prefecture: null,
          time: null,
          venue: null,
        }),
      ],
      now: NOW,
    });
    expect(fresh.updated).toEqual([]);
    expect(Object.values(fresh.state.concerts)[0]).toMatchObject({
      read: false,
      update: null,
    });
    const sparse = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [
        listing({ venue: null, prefecture: null, time: null }),
        listing({
          siteId: '9',
          venue: 'X',
          prefecture: 'P',
          time: '19:00',
          image: 'i',
        }),
      ],
      now: NOW,
    });
    expect(Object.values(sparse.state.concerts)[0]).toMatchObject({
      venue: 'X',
      prefecture: 'P',
      time: '19:00',
      image: 'i',
    });
  });

  test('a refreshed listing moves the concert to its new date and venue', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing()],
      now: NOW,
    });
    const [id] = first.created;
    const moved = listing({
      dates: ['2027-01-20'],
      venue: '横浜アリーナ',
      prefecture: '神奈川県',
      time: '17:00',
    });
    const r = ingest(first.state, {
      keyword: 'ヨルシカ',
      listings: [moved],
      now: '2026-11-20T00:00:00.000Z',
    });
    expect(r.state.concerts[id]).toMatchObject({
      dates: ['2027-01-20'],
      venue: '横浜アリーナ',
      prefecture: '神奈川県',
      time: '17:00',
    });
    const pruned = prune(r.state, { today: '2026-12-13' });
    expect(Object.keys(pruned.concerts)).toEqual([id]);

    // With a second site still on the old date, the concert spans both.
    const two = ingest(first.state, {
      keyword: 'ヨルシカ',
      listings: [listing({ site: 'pia', siteId: 'p1' })],
      now: NOW,
    });
    const again = ingest(two.state, {
      keyword: 'ヨルシカ',
      listings: [moved],
      now: NOW,
    });
    expect(again.state.concerts[id]).toMatchObject({
      dates: ['2026-12-05', '2027-01-20'],
      venue: '横浜アリーナ',
    });
  });

  test('a seen listing that opens a new sale updates a read concert', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing()],
      now: NOW,
    });
    const [id] = first.created;
    const later = '2026-11-20T00:00:00.000Z';
    const general = listing({ saleLabel: '一般発売' });

    const r = ingest(markRead(first.state, id), {
      keyword: 'ヨルシカ',
      listings: [general],
      now: later,
    });

    expect(r).toMatchObject({ created: [], updated: [id] });
    expect(r.state.concerts[id]).toMatchObject({
      read: false,
      update: 'New sale: 一般発売',
      updatedAt: later,
    });
    expect(r.state.concerts[id].offers[0].saleLabel).toBe('一般発売');
  });

  test('a seen listing with a new sale stays quiet when unread, in baseline, or unchanged', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing()],
      now: NOW,
    });
    const [id] = first.created;
    const general = listing({ saleLabel: '一般発売' });

    const unread = ingest(first.state, {
      keyword: 'ヨルシカ',
      listings: [general],
      now: NOW,
    });
    const baseline = ingest(markRead(first.state, id), {
      keyword: 'ヨルシカ',
      listings: [general],
      now: NOW,
      baseline: true,
    });
    const closed = ingest(markRead(first.state, id), {
      keyword: 'ヨルシカ',
      listings: [listing({ saleLabel: null })],
      now: NOW,
    });

    expect(unread.updated).toEqual([]);
    expect(unread.state.concerts[id]).toMatchObject({
      read: false,
      update: null,
    });
    expect(baseline.updated).toEqual([]);
    expect(baseline.state.concerts[id].read).toBe(true);
    expect(closed.updated).toEqual([]);
    expect(closed.state.concerts[id].read).toBe(true);
  });

  test('a sale status that ends, sells out, or cancels is not a new sale', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [listing({ site: 'livepocket', saleLabel: '販売中' })],
      now: NOW,
    });
    const [id] = first.created;
    for (const label of ['売切', '販売終了', '中止', '受付終了', 'SOLD OUT']) {
      const r = ingest(markRead(first.state, id), {
        keyword: 'ヨルシカ',
        listings: [listing({ site: 'livepocket', saleLabel: label })],
        now: NOW,
      });
      expect(r.updated, label).toEqual([]);
      expect(r.state.concerts[id], label).toMatchObject({
        read: true,
        update: null,
      });
      // The offer still shows the new status.
      expect(r.state.concerts[id].offers[0].saleLabel).toBe(label);
    }
  });

  test('a later sale start under the same label is a new sale', () => {
    const open = (/** @type {string} */ saleStart) =>
      listing({ site: 'asobi', saleLabel: '受付中', saleStart });
    const first = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [open('2026-11-01T03:00:00.000Z')],
      now: NOW,
    });
    const [id] = first.created;
    const same = ingest(markRead(first.state, id), {
      keyword: 'ヨルシカ',
      listings: [open('2026-11-01T03:00:00.000Z')],
      now: NOW,
    });
    const next = ingest(markRead(first.state, id), {
      keyword: 'ヨルシカ',
      listings: [open('2026-11-20T03:00:00.000Z')],
      now: NOW,
    });

    expect(same.updated).toEqual([]);
    expect(next.updated).toEqual([id]);
    expect(next.state.concerts[id]).toMatchObject({
      read: false,
      update: 'New sale: 受付中',
    });
  });

  test('ingest refreshes a seen listing whose concert was deleted', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [listing()],
      now: NOW,
    });
    const gone = remove(first.state, first.created);
    const r = ingest(gone, {
      keyword: 'k',
      listings: [listing()],
      now: '2026-11-18T00:00:00.000Z',
    });
    expect(r.created).toEqual([]);
    expect(Object.keys(r.state.concerts)).toEqual([]);
  });

  test('a deleted concert does not come back through another site', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [listing()],
      now: NOW,
    });
    const gone = remove(first.state, [...first.created, 'missing']);
    expect(gone.tombstones).toHaveLength(1);
    const r = ingest(gone, {
      keyword: 'k',
      listings: [listing({ site: 'pia', siteId: 'x' })],
      now: NOW,
    });
    expect(r.created).toEqual([]);
    expect(r.state.seen['pia:x'].concertId).toBe(first.created[0]);
  });

  test('read, star, clear, list, and prune', () => {
    const first = ingest(emptyInbox(), {
      keyword: 'k',
      listings: [
        listing(),
        listing({
          siteId: '2',
          dates: ['2026-12-24'],
          venue: 'Zepp',
          title: 'xmas',
        }),
        listing({
          siteId: '3',
          dates: ['2026-11-01'],
          venue: 'old',
          title: 'past',
        }),
      ],
      now: NOW,
    });
    let { state } = first;
    const [a, b, c] = first.created;
    expect(unreadCount(state)).toBe(3);
    state = setStarred(markRead(state, a), a);
    state = markRead(state, b);
    expect(clearableIds(state)).toEqual([b]);
    expect(setStarred(state, a, true).concerts[a].starred).toBe(true);
    expect(setStarred(state, 'nope')).toBe(state);
    expect(markRead(state, b, false).concerts[b]).toMatchObject({
      read: false,
    });
    expect(list(state, 'unread').map((x) => x.id)).toEqual([c]);
    expect(list(state, 'starred').map((x) => x.id)).toEqual([a]);
    expect(list(state).map((x) => x.id)).toEqual([c, a, b]);
    expect(unreadCount(markAllRead(state))).toBe(0);

    state = {
      ...state,
      concerts: {
        ...state.concerts,
        [a]: { ...state.concerts[a], updatedAt: '2026-11-18', dates: [] },
      },
    };
    expect(list(state)[0].id).toBe(a);
    const tomb = remove(state, [b]);
    const pruned = prune(tomb, { today: '2027-01-10' });
    expect(Object.keys(pruned.concerts).sort()).toEqual([a].sort());
    expect(pruned.tombstones).toEqual([]);
    expect(Object.keys(pruned.seen)).toHaveLength(3);
    expect(Object.keys(prune(tomb, { today: '2027-12-01' }).seen)).toHaveLength(
      0
    );
  });
});

describe('settings', () => {
  test('splitKeywords splits, trims, and de-duplicates', () => {
    expect(
      splitKeywords(
        'ヨルシカ\nBUMP OF CHICKEN\n\n back number \r\n花譜\tｂａｃｋ　ｎｕｍｂｅｒ\n・',
        ['花譜']
      )
    ).toEqual({
      added: ['ヨルシカ', 'BUMP OF CHICKEN', 'back number'],
      duplicates: ['花譜', 'back number'],
    });
  });

  test('splitKeywords keeps commas and 、 inside an artist name', () => {
    expect(
      splitKeywords('Earth, Wind & Fire\nCrosby、Stills\tTyler, The Creator')
    ).toEqual({
      added: ['Earth, Wind & Fire', 'Crosby、Stills', 'Tyler, The Creator'],
      duplicates: [],
    });
  });

  test('stored keywords and renames with commas stay whole', () => {
    const s = normalizeSettings({ keywords: ['Earth, Wind & Fire', 'A'] });
    expect(s.keywords).toEqual(['Earth, Wind & Fire', 'A']);
    expect(
      applySettingsChange(s, {
        type: 'renameKeyword',
        from: 'A',
        to: 'Crosby, Stills, Nash & Young',
      }).keywords
    ).toEqual(['Earth, Wind & Fire', 'Crosby, Stills, Nash & Young']);
  });

  test('applySettingsChange applies one edit to the current settings', () => {
    const s = { ...defaultSettings(), keywords: ['A', 'B', 'C'] };
    expect(
      applySettingsChange(s, { type: 'set', key: 'notify', value: false })
        .notify
    ).toBe(false);
    expect(
      applySettingsChange(s, {
        type: 'set',
        key: 'intervalMinutes',
        value: 180,
      }).intervalMinutes
    ).toBe(180);
    expect(
      applySettingsChange(s, { type: 'site', site: 'pia', on: false }).sites
    ).toEqual({ pia: false });
    expect(
      applySettingsChange(s, { type: 'addKeywords', keywords: ['D', 'ａ'] })
        .keywords
    ).toEqual(['A', 'B', 'C', 'D']);
    expect(
      applySettingsChange(s, { type: 'removeKeyword', keyword: 'B' }).keywords
    ).toEqual(['A', 'C']);
    expect(
      applySettingsChange(s, { type: 'renameKeyword', from: 'B', to: ' X ' })
        .keywords
    ).toEqual(['A', 'X', 'C']);
    // Renaming to a duplicate, or a keyword removed meanwhile, changes nothing.
    expect(
      applySettingsChange(s, { type: 'renameKeyword', from: 'B', to: 'c' })
    ).toBe(s);
    expect(
      applySettingsChange(s, { type: 'renameKeyword', from: 'Z', to: 'X' })
    ).toBe(s);
  });

  test('normalizeSettings fills defaults and drops junk', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(
      normalizeSettings({
        keywords: 'x',
        intervalMinutes: 7,
        sites: 3,
        notify: 'y',
      })
    ).toEqual(defaultSettings());
    const s = normalizeSettings({
      keywords: ['a', 1, 'A', 'b'],
      intervalMinutes: 180,
      sites: { pia: false, eplus: 'no' },
      notify: false,
      notifyUpdates: true,
      tabFallback: true,
    });
    expect(s).toEqual({
      keywords: ['a', 'b'],
      intervalMinutes: 180,
      sites: { pia: false },
      notify: false,
      notifyUpdates: true,
      tabFallback: true,
    });
    expect(siteEnabled(s, 'pia')).toBe(false);
    expect(siteEnabled(s, 'eplus')).toBe(true);
  });
});

describe('schedule', () => {
  test('enqueue, pick with gaps, and retain', () => {
    let s = enqueueRound(emptySchedule(), {
      keywords: ['a', 'b'],
      sites: ['x', 'y'],
      now: 0,
    });
    s = enqueueRound(s, { keywords: ['a'], sites: ['x'], now: 1 });
    expect(s.queue).toEqual([
      { keyword: 'a', site: 'x' },
      { keyword: 'a', site: 'y' },
      { keyword: 'b', site: 'x' },
      { keyword: 'b', site: 'y' },
    ]);
    expect(s.lastRunAt).toBe(1);
    let pick = /** @type {any} */ (pickJob(s, 10_000));
    expect(pick.index).toBe(0);
    s = startJob(s, pick.index, 10_000);
    pick = pickJob(s, 10_000);
    expect(pick).toMatchObject({ job: { keyword: 'a', site: 'y' } });
    s = startJob(s, /** @type {any} */ (pick).index, 10_000);
    expect(pickJob(s, 11_000)).toEqual({ waitMs: 2_000 });
    expect(pickJob(s, 13_000)).toMatchObject({
      job: { keyword: 'b', site: 'x' },
    });
    expect(retain(s, { keywords: ['b'], sites: ['y'] }).queue).toEqual([
      { keyword: 'b', site: 'y' },
    ]);
    expect(pickJob(emptySchedule(), 0)).toBeNull();
  });

  test('finishJob cools down blocked and failing sites, and tracks baselines', () => {
    const job = { keyword: 'a', site: 'x' };
    let s = emptySchedule();
    expect(isBaseline(s, job)).toBe(true);
    s = finishJob(s, job, { kind: 'blocked', error: '403' }, 0);
    expect(s.sites.x).toMatchObject({
      failures: 1,
      cooldownUntil: 30 * 60_000,
      lastError: '403',
    });
    s = finishJob(s, job, { kind: 'blocked', error: '403' }, 0);
    expect(s.sites.x.cooldownUntil).toBe(60 * 60_000);
    for (let i = 0; i < 10; i++)
      s = finishJob(s, job, { kind: 'error', error: 'net' }, 0);
    expect(s.sites.x.cooldownUntil).toBe(24 * 60 * 60_000);
    s = enqueueRound(s, { keywords: ['a'], sites: ['x'], now: 0 });
    expect(pickJob(s, 1_000)).toEqual({ waitMs: 24 * 60 * 60_000 - 1_000 });
    s = finishJob(s, job, { kind: 'ok', count: 4 }, 5);
    expect(s.sites.x).toMatchObject({
      failures: 0,
      cooldownUntil: 0,
      lastOkAt: 5,
      lastError: null,
      lastCount: 4,
    });
    expect(isBaseline(s, job)).toBe(false);
    expect(s.log.at(-1)).toEqual({
      at: 5,
      site: 'x',
      keyword: 'a',
      kind: 'ok',
      count: 4,
      error: null,
    });
    expect(s.log[0]).toMatchObject({
      kind: 'blocked',
      count: null,
      error: '403',
    });
    for (let i = 0; i < 70; i++)
      s = finishJob(s, job, { kind: 'ok', count: i }, i);
    expect(s.log).toHaveLength(60);
    expect(
      finishJob(
        { ...emptySchedule(), log: undefined },
        job,
        { kind: 'ok', count: 1 },
        0
      ).log
    ).toHaveLength(1);
    expect(
      finishJob(emptySchedule(), job, { kind: 'error', error: 'e' }, 0).sites.x
        .cooldownUntil
    ).toBe(10 * 60_000);
  });
});
