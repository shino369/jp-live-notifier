// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import { localParse } from '../extension/src/lib/job.js';
import { defaultSettings } from '../extension/src/lib/settings.js';
import {
  ADAPTERS,
  adapterById,
  adapterOn,
} from '../extension/src/sites/index.js';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');
const NOW = new Date(2026, 10, 17);
const parse = localParse(new DOMParser());

/** @param {string} site @param {string} file @param {string} [keyword] */
const load = (site, file, keyword = 'x') =>
  parse(
    /** @type {any} */ (adapterById(site)),
    fs.readFileSync(path.join(FIXTURES, file), 'utf-8'),
    { keyword, now: NOW, page: 1 }
  );

const shape = {
  site: expect.any(String),
  siteId: expect.any(String),
  url: expect.stringMatching(/^https:\/\//),
  title: expect.any(String),
  performers: expect.any(Array),
  dates: expect.any(Array),
};

describe('registry', () => {
  test('ZAN-LIVE and ZAIKO are opt-in (their terms forbid bots); the rest default on', () => {
    const settings = defaultSettings();
    const on = ADAPTERS.filter((a) => adapterOn(settings, a)).map((a) => a.id);
    expect(on).toEqual([
      'eplus',
      'ltike',
      'pia',
      'rakuten',
      'livepocket',
      'asobi',
    ]);
    for (const id of ['zanlive', 'zaiko']) {
      const a = /** @type {any} */ (adapterById(id));
      expect(a.optIn.terms).toMatch(/^https:\/\/.*terms/);
      expect(adapterOn({ ...settings, sites: { [id]: true } }, a)).toBe(true);
    }
    expect(
      adapterOn(
        { ...settings, sites: { pia: false } },
        /** @type {any} */ (adapterById('pia'))
      )
    ).toBe(false);
  });

  test('the manifest grants host access to every URL an adapter fetches', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../extension/manifest.json'),
        'utf-8'
      )
    );
    /** @param {string} url */
    const granted = (url) =>
      manifest.host_permissions.some((/** @type {string} */ p) =>
        new RegExp(
          `^${p.replace(/[.?]/g, '\\$&').replaceAll('*', '[^/]*')}`
        ).test(url)
      );
    for (const a of ADAPTERS)
      for (const r of a.requests('ヨルシカ'))
        expect(granted(r.url), r.url).toBe(true);
  });

  test('every adapter has the full interface and https URLs', () => {
    for (const a of ADAPTERS) {
      expect(a).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        format: expect.stringMatching(/^(html|json)$/),
      });
      expect(a.searchUrl('ヨルシカ')).toMatch(/^https:\/\//);
      for (const r of a.requests('ヨルシカ'))
        expect(r.url).toMatch(/^https:\/\//);
      if (a.format === 'html') expect(a.expect).toBeInstanceOf(RegExp);
    }
    expect(adapterById('nope')).toBeUndefined();
  });
});

describe('eplus', () => {
  test('reads performances from the embedded JSON', async () => {
    const items = await load('eplus', 'eplus-bump-of-chicken.html');
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({
      ...shape,
      site: 'eplus',
      siteId: '/sf/detail/0025330001-P0030241P021001',
      url: 'https://eplus.jp/sf/detail/0025330001-P0030241P021001',
      title: 'BUMP OF CHICKEN',
      dates: ['2026-11-21'],
      time: '18:00',
      venue: 'あなぶきアリーナ香川',
      prefecture: '香川県',
    });
    expect(items[0].saleLabel).not.toMatch(/^☆/);
    expect(items[0].saleStart).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  test('returns nothing without hits or without the JSON block', async () => {
    expect(await load('eplus', 'eplus-noresult.html')).toEqual([]);
    expect(await load('eplus', 'eplus-word-0000136266.html')).toEqual([]);
  });
});

describe('ltike', () => {
  test('reads the Japanese source under WOVN translations', async () => {
    const [item] = await load('ltike', 'ltike-yorushika.rendered-dom.html');
    expect(item).toMatchObject({
      ...shape,
      site: 'ltike',
      url: 'https://l-tike.com/order/?gLcode=75161',
      title: 'TK from 凛として時雨',
      dates: ['2026-12-27'],
      venue: '日本武道館',
      prefecture: '東京都',
      saleLabel: '一般発売・先着',
      saleStart: '2026/10/10(土) 10:00',
      saleEnd: '2026/12/21(月) 22:00 (発売中)',
    });
    expect(item.siteId).toMatch(/^75161:/);
  });

  test('reads one listing per sale on a full page', async () => {
    const items = await load('ltike', 'ltike-live-sort2desc.rendered-dom.html');
    expect(items.length).toBe(32);
    expect(await load('ltike', 'ltike-noresult.rendered-dom.html')).toEqual([]);
  });
});

describe('pia', () => {
  test('reads one listing per sale link with date, venue, prefecture', async () => {
    const items = await load('pia', 'pia-ado-rlsInfo.html');
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items[0]).toMatchObject({
      ...shape,
      site: 'pia',
      siteId: '2634793:001',
      title: '藝大定期邦楽 第92回',
      dates: ['2026-11-18'],
      venue: '日本橋公会堂(日本橋劇場)',
      prefecture: '東京都',
      saleLabel: '一般発売',
    });
    expect(new Set(items.map((i) => i.siteId)).size).toBe(items.length);
  });

  test('returns nothing for a no-hit page', async () => {
    expect(await load('pia', 'pia-nohit-rlsInfo.html')).toEqual([]);
  });
});

describe('rakuten', () => {
  test('reads title, date, venue, sale label and period', async () => {
    const [item] = await load('rakuten', 'rakuten-kafu.html');
    expect(item).toMatchObject({
      ...shape,
      site: 'rakuten',
      siteId: 'rttisja',
      dates: ['2026-09-06'],
      venue: 'パシフィコ横浜',
      saleLabel: '一般発売',
      saleStart: '2025/01/01(水) 12:00',
    });
    expect(item.title).not.toMatch(/外部サイト|楽天ポイント/);
    expect(item.title).toContain('花譜');
  });

  test('reads a full page without the mobile duplicates', async () => {
    const items = await load('rakuten', 'rakuten-koen-paging.html');
    expect(items).toHaveLength(20);
    expect(await load('rakuten', 'rakuten-yorushika.html')).toEqual([]);
  });
});

describe('livepocket', () => {
  test('reads cards with date, time, venue, prefecture, cast, and status', async () => {
    const [item] = await load('livepocket', 'livepocket-yorushika.html');
    expect(item).toMatchObject({
      ...shape,
      site: 'livepocket',
      siteId: 'ww1ek',
      url: 'https://livepocket.jp/e/ww1ek',
      dates: ['2026-11-23'],
      time: '13:00',
      venue: '武蔵野大学 武蔵野キャンパス 紅雲台1Fホール',
      prefecture: '東京都',
      saleLabel: '販売中',
    });
    expect(item.performers).toContain('文月悠光(詩人)');
    expect(item.image).toMatch(/^https:/);
  });

  test('reads 20 cards from a full page and none from a no-hit page', async () => {
    expect(await load('livepocket', 'livepocket-bump.html')).toHaveLength(20);
    expect(await load('livepocket', 'livepocket-kafu.html')).toEqual([]);
  });
});

describe('asobi', () => {
  test('lists public booths with slug dates and images', async () => {
    const items = await load('asobi', 'asobi-booths.json');
    expect(items).toHaveLength(15);
    const cg = items.find((i) => i.siteId === 'cinderellagirls-270111');
    expect(cg).toMatchObject({
      ...shape,
      url: 'https://asobiticket2.asobistore.jp/booths/cinderellagirls-270111',
      dates: ['2027-01-11'],
    });
    // A plain status: the count of open receptions goes down when one closes,
    // which must not read as a new sale (a new one moves saleStart instead).
    for (const i of items) expect([null, '受付中']).toContain(i.saleLabel);
    expect(
      items.find((i) => i.siteId === 'cinderellagirls-millionlive-20270227')
        ?.dates
    ).toEqual(['2027-02-27']);
    expect(items.find((i) => i.siteId === 'va-liv-3rdlive')?.dates).toEqual([]);
  });

  test('tolerates empty or odd JSON', async () => {
    const asobi = /** @type {any} */ (adapterById('asobi'));
    expect(asobi.parse({}, { keyword: 'x', now: NOW, page: 1 })).toEqual([]);
    expect(
      asobi.parse(
        {
          data: [
            { id: 'a-261399', attributes: { name: 'n' } },
            { id: 'b', attributes: { name: 'x', status: 'draft' } },
            { attributes: {} },
          ],
        },
        { keyword: 'x', now: NOW, page: 1 }
      )
    ).toMatchObject([{ siteId: 'a-261399', dates: [], saleLabel: null }]);
  });
});

describe('results-page markers', () => {
  const pages = {
    eplus: ['eplus-yorushika.html', 'eplus-noresult.html'],
    ltike: [
      'ltike-yorushika.rendered-dom.html',
      'ltike-noresult.rendered-dom.html',
    ],
    pia: ['pia-ado-rlsInfo.html', 'pia-nohit-rlsInfo.html'],
    rakuten: ['rakuten-kafu.html', 'rakuten-yorushika.html'],
    livepocket: ['livepocket-yorushika.html', 'livepocket-none.html'],
  };
  test.each(Object.entries(pages))(
    '%s: hit and no-hit pages both carry the marker',
    (site, files) => {
      const { expect: marker } = /** @type {any} */ (adapterById(site));
      for (const f of files)
        expect(
          marker.test(fs.readFileSync(path.join(FIXTURES, f), 'utf-8'))
        ).toBe(true);
      expect(marker.test('<html><body>challenge</body></html>')).toBe(false);
    }
  );
});

describe('zanlive', () => {
  test('lists every card of the home page once, dated where any card has the date', async () => {
    const items = await load('zanlive', 'zanlive-home.html');
    const ids = items.map((i) => i.siteId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items.length).toBeGreaterThan(40);
    expect(items.find((i) => i.siteId === '11031')).toMatchObject({
      ...shape,
      site: 'zanlive',
      url: 'https://www.zan-live.com/ja/live/detail/11031',
      title: '言霊生誕祭',
      dates: ['2026-11-19'],
      time: '17:00',
      venue: null,
      image: expect.stringMatching(/^https:\/\/storage\.zan-live\.com\//),
    });
    // Online only: the venue says so; hybrid (会場 + オンライン) stays unknown.
    expect(items.find((i) => i.siteId === '11046')?.venue).toBeNull();
    expect(items.some((i) => i.venue === 'オンライン')).toBe(true);
    // Cards of the lottery section carry its status.
    expect(items.some((i) => i.saleLabel === '抽選受付中')).toBe(true);
  });

  test('a page without cards parses to nothing; the page check needs a card', async () => {
    const zan = /** @type {any} */ (adapterById('zanlive'));
    expect(await load('zanlive', 'eplus-noresult.html')).toEqual([]);
    expect(zan.expect.test('<h3 class="c-event-card__title">x</h3>')).toBe(
      true
    );
    expect(zan.expect.test('<html>404 Not Found</html>')).toBe(false);
  });
});

describe('zaiko', () => {
  test('reads the results of the search page data (title, link, poster)', async () => {
    const items = await load('zaiko', 'zaiko-trysail.html');
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      ...items[0],
      site: 'zaiko',
      siteId: '386546',
      url: 'https://secondshot.zaiko.io/ja/e/try2026-live',
      title: '【配信】TrySailのTRYangle harmony 番組イベント2026',
      dates: [],
      image: expect.stringMatching(/^https:\/\/media\.zaiko\.io\//),
    });
    expect(await load('zaiko', 'zaiko-noresult.html')).toEqual([]);
    // Fuzzy hits come back too; the job's local filter drops them.
    expect(await load('zaiko', 'zaiko-yorushika.html')).toHaveLength(5);
  });

  test('the page check needs the search page data; odd data parses to nothing', () => {
    const zaiko = /** @type {any} */ (adapterById('zaiko'));
    expect(zaiko.searchUrl('ヰ世界情緒')).toBe(
      'https://zaiko.io/ja/search?q=%E3%83%B0%E4%B8%96%E7%95%8C%E6%83%85%E7%B7%92'
    );
    expect(zaiko.expect.test('<div>Main/Search</div>')).toBe(false);
    const doc = (/** @type {string} */ json) =>
      new DOMParser().parseFromString(
        `<script data-page="app" type="application/json">${json}</script>`,
        'text/html'
      );
    const ctx = { keyword: 'x', now: NOW, page: 1 };
    expect(zaiko.parse(doc('{"props":{}}'), ctx)).toEqual([]);
    expect(
      zaiko.parse(
        doc(
          '{"props":{"results":[{"id":1,"title":"x"},{"id":2,"title":"y","action":{"url":"javascript:alert(1)"}},{"title":"z","action":{"url":"https://a.zaiko.io/e/z"}}]}}'
        ),
        ctx
      )
    ).toEqual([]);
    expect(
      zaiko.parse(new DOMParser().parseFromString('', 'text/html'), ctx)
    ).toEqual([]);
  });
});
