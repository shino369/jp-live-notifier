#!/usr/bin/env node
/**
 * Chrome Web Store images, per listing language:
 *
 *   store/icon-128.png                  the icon, 96 px artwork with 16 px padding
 *   store/<lang>/screenshot-N-<page>.png 1280 × 800, a caption above a real page
 *   store/<lang>/promo-440x280.png      the small promo tile
 *
 * The pages are the real extension in Chromium started in that UI language
 * (e2e/locale-browser.js), offline, with invented demo data: fictional
 * artists and generated posters, and the corner illustration hidden, so no
 * real artist or third-party artwork appears in the listing. Pages are captured at 2× and composed at exactly the store's size.
 *
 * Usage: pnpm store-assets [en] [ja]   (both when none is given)
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { launchInLocale } from '../e2e/locale-browser.js';
import { padded } from './make-icons.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'store');
const LANGS = ['en', 'ja'];

/** Store text per language: screenshot captions and the promo tagline. */
export const TEXT = {
  en: {
    inbox: 'Every new live from your oshi, in one inbox',
    popup: 'What’s new, one click away in the toolbar',
    settings: 'Add your artists, choose the ticket sites',
    dark: 'Light and dark themes',
    tagline: 'New lives from your oshi, the moment they’re listed',
  },
  ja: {
    inbox: '推しの新着ライブを、ひとつの受信箱に',
    popup: 'ツールバーからワンクリックで確認',
    settings: 'アーティストを登録して、チケットサイトを選ぶだけ',
    dark: 'ダークテーマにも対応',
    tagline: '推しの新着ライブを、掲載されたらすぐお知らせ',
  },
};

/** Brand colours (the icon's red, and M3 surfaces). */
const RED = '#d93025';

/**
 * A made-up poster as an SVG data URL.
 *
 * @param {string} title
 * @param {string} from
 * @param {string} to
 */
const poster = (title, from, to) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="960" height="540" fill="url(#g)"/>
      <circle cx="760" cy="120" r="180" fill="#fff" opacity="0.12"/>
      <circle cx="160" cy="470" r="230" fill="#fff" opacity="0.08"/>
      <text x="64" y="300" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="72" font-weight="700" fill="#fff">${title}</text>
      <text x="64" y="370" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="34" fill="#fff" opacity="0.85">LIVE 2027</text>
    </svg>`
  ).toString('base64')}`;

/** Demo storage: fictional artists, five shows, healthy sites. */
export function demo(now = Date.now()) {
  const ago = (/** @type {number} */ min) =>
    new Date(now - min * 60_000).toISOString();
  const URLS = {
    eplus: 'https://eplus.jp/',
    ltike: 'https://l-tike.com/',
    pia: 'https://t.pia.jp/',
    rakuten: 'https://ticket.rakuten.co.jp/',
    livepocket: 'https://livepocket.jp/',
  };
  /**
   * @param {{ id: string, artist: string, title: string, dates: string[], time: string,
   *   venue: string, pref: string, sales: Array<[keyof typeof URLS, string]>, min: number,
   *   read?: boolean, starred?: boolean, update?: object | null, image?: string | null }} s
   */
  const show = ({
    id,
    artist,
    title,
    dates,
    time,
    venue,
    pref,
    sales,
    min,
    read = true,
    starred = false,
    update = null,
    image = null,
  }) => ({
    id,
    keywords: [artist],
    title,
    performers: [artist],
    venue,
    prefecture: pref,
    dates,
    time,
    image,
    offers: sales.map(([site, sale]) => ({
      site,
      siteId: `${id}-${site}`,
      url: `${URLS[site]}demo/${id}`,
      title,
      performers: [artist],
      venue,
      prefecture: pref,
      dates,
      time,
      saleLabel: sale,
      saleStart: null,
      saleEnd: null,
      image,
      firstSeenAt: ago(min),
      lastSeenAt: ago(1),
    })),
    createdAt: ago(min),
    updatedAt: ago(min),
    read,
    starred,
    update,
  });
  const concerts = [
    show({
      id: 'demo1',
      artist: '星屑メトロノーム',
      title: '星屑メトロノーム LIVE TOUR 2027「軌跡」',
      dates: ['2027-02-11'],
      time: '18:00',
      venue: 'Kアリーナ横浜',
      pref: '神奈川県',
      sales: [
        ['eplus', '先行受付中'],
        ['pia', 'プレリザーブ'],
      ],
      min: 4,
      image: poster('星屑メトロノーム', '#3949ab', '#ec407a'),
    }),
    show({
      id: 'demo2',
      artist: 'ミナモ',
      title: 'ミナモ ONE-MAN LIVE 2027「水面」',
      dates: ['2027-01-23', '2027-01-24'],
      time: '17:30',
      venue: '日本武道館',
      pref: '東京都',
      sales: [['ltike', '一般発売']],
      min: 38,
      read: false,
      update: { key: 'updateNewSale', args: ['一般発売'] },
      image: poster('ミナモ', '#00897b', '#80deea'),
    }),
    show({
      id: 'demo3',
      artist: 'Lumina Drift',
      title: 'Lumina Drift ASIA TOUR 2026 TOKYO',
      dates: ['2026-12-19'],
      time: '19:00',
      venue: 'Zepp Haneda',
      pref: '東京都',
      sales: [['livepocket', '販売中']],
      min: 95,
      read: false,
      starred: true,
      image: poster('Lumina Drift', '#4a148c', '#ff7043'),
    }),
    show({
      id: 'demo4',
      artist: 'ミナモ',
      title: 'ミナモ HALL TOUR 2027',
      dates: ['2027-03-06'],
      time: '18:00',
      venue: '大阪城ホール',
      pref: '大阪府',
      sales: [['rakuten', '販売中']],
      min: 180,
    }),
    show({
      id: 'demo5',
      artist: '星屑メトロノーム',
      title: '星屑メトロノーム 特別公演',
      dates: ['2026-12-28'],
      time: '19:30',
      venue: '東京国際フォーラム ホールA',
      pref: '東京都',
      sales: [['eplus', '抽選受付']],
      min: 300,
    }),
  ];
  const ok = {
    lastRequestAt: now - 9 * 60_000,
    cooldownUntil: 0,
    failures: 0,
    lastOkAt: now - 9 * 60_000,
    lastError: null,
    lastCount: 1,
  };
  return {
    // Appearance → Hidden: the bundled fan art stays out of the store's
    // marketing images (the extension still shows it by default).
    decor: { mode: 'none' },
    settings: {
      keywords: ['星屑メトロノーム', 'ミナモ', 'Lumina Drift'],
      // LivePocket and ぴあ are opt-in; the demo user turned them on.
      sites: { livepocket: true, pia: true },
    },
    inbox: {
      concerts: Object.fromEntries(concerts.map((c) => [c.id, c])),
      seen: {},
      tombstones: [],
    },
    schedule: {
      queue: [],
      synced: {},
      lastRunAt: now - 9 * 60_000,
      log: [],
      sites: Object.fromEntries(
        ['eplus', 'ltike', 'pia', 'rakuten', 'livepocket', 'asobi'].map((s) => [
          s,
          ok,
        ])
      ),
    },
  };
}

/** HTML-escape text for the composed pages. @param {string} s */
const esc = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
  );

const FONT =
  "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Segoe UI', sans-serif";

/**
 * A 1280 × 800 store screenshot: the caption, then the page image framed.
 *
 * @param {{ caption: string, image: string, width: number, height: number, dark: boolean }} o
 *   `image`: data URL; width/height: how large to show it (CSS px)
 */
const screenshotPage = ({
  caption,
  image,
  width,
  height,
  dark,
}) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { font-family: ${FONT}; display: flex; flex-direction: column; align-items: center;
    background: ${dark ? 'linear-gradient(160deg, #1d1b20, #2b2930)' : 'linear-gradient(160deg, #fff4f2, #fde7e4)'}; }
  h1 { margin: 44px 0 30px; font-size: 40px; font-weight: 700; letter-spacing: 0.01em;
    color: ${dark ? '#f3eff4' : '#3b1512'}; }
  img { width: ${width}px; height: ${height}px; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, ${dark ? 0.55 : 0.18}); }
</style></head><body><h1>${esc(caption)}</h1><img src="${image}"></body></html>`;

/**
 * The 440 × 280 promo tile.
 *
 * @param {{ name: string, tagline: string, icon: string }} o
 */
const promoPage = ({ name, tagline, icon }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body { font-family: ${FONT}; display: flex; flex-direction: column;
    justify-content: center; padding: 0 36px; box-sizing: border-box; color: #3b1512;
    background: radial-gradient(circle at 88% 12%, rgba(217, 48, 37, 0.18) 0, transparent 42%),
      linear-gradient(160deg, #fff4f2, #fde1dc); }
  img { width: 76px; height: 76px; margin: 0 0 14px -8px;
    filter: drop-shadow(0 6px 12px rgba(161, 22, 42, 0.25)); }
  h1 { margin: 0 0 8px; font-size: 30px; font-weight: 800; color: ${RED}; }
  p { margin: 0; font-size: 16px; line-height: 1.5; }
</style></head><body><img src="${icon}"><h1>${esc(name)}</h1><p>${esc(tagline)}</p></body></html>`;

/**
 * Width and height from a PNG's IHDR.
 *
 * @param {Buffer} png
 */
export const pngSize = (png) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

/**
 * Every image for one language.
 *
 * @param {string} lang
 * @param {Buffer} icon the padded store icon
 */
async function assetsFor(lang, icon) {
  const text = TEXT[/** @type {'en' | 'ja'} */ (lang)];
  const dir = path.join(OUT, lang);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launchInLocale({ extension: EXT, lang, offline: true });
  try {
    const { context, worker, id } = browser;
    await worker.evaluate(
      async (data) => chrome.storage.local.set(data),
      demo()
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    /** @param {number} width @param {number} height @param {number} scale */
    const viewport = (width, height, scale) =>
      cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      });
    const base = `chrome-extension://${id}/src/ui`;
    /**
     * A page of the extension at 2×, as a data URL.
     *
     * @param {string} url
     * @param {number} width
     * @param {number} height
     * @param {'light' | 'dark'} scheme
     * @param {string} [top] scroll this element to the top of the view
     */
    const capture = async (url, width, height, scheme, top) => {
      await viewport(width, height, 2);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${base}/${url}`);
      await page.waitForTimeout(1200);
      // No scrollbars in a marketing image.
      await page.addStyleTag({ content: 'html { scrollbar-width: none; }' });
      if (top)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const bar = document.querySelector('.top-app-bar');
          // Just below the sticky top bar.
          const offset = (bar?.getBoundingClientRect().height ?? 0) + 2;
          if (el) window.scrollTo(0, el.getBoundingClientRect().top - offset);
        }, top);
      await page.waitForTimeout(200);
      const png = await page.screenshot();
      return `data:image/png;base64,${png.toString('base64')}`;
    };
    /**
     * Compose and save one store image at exactly its size.
     *
     * @param {string} html
     * @param {number} width
     * @param {number} height
     * @param {string} file
     */
    const compose = async (html, width, height, file) => {
      await viewport(width, height, 1);
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setContent(html);
      await page.waitForTimeout(300);
      const png = await page.screenshot({ type: 'png' });
      const size = pngSize(png);
      if (size.width !== width || size.height !== height)
        throw new Error(`${file} is ${size.width}×${size.height}`);
      fs.writeFileSync(path.join(dir, file), png);
    };

    const shots = [
      {
        file: 'screenshot-1-inbox.png',
        caption: text.inbox,
        image: await capture('inbox.html#demo1', 1280, 760, 'light'),
        width: 1100,
        height: 653,
        dark: false,
      },
      {
        file: 'screenshot-2-popup.png',
        caption: text.popup,
        image: await capture('popup.html', 400, 600, 'light'),
        width: 427,
        height: 640,
        dark: false,
      },
      {
        file: 'screenshot-3-settings.png',
        caption: text.settings,
        // From the artist rows down to the first ticket sites.
        image: await capture('options.html', 1280, 760, 'light', '#keywords'),
        width: 1100,
        height: 653,
        dark: false,
      },
      {
        file: 'screenshot-4-dark.png',
        caption: text.dark,
        image: await capture('inbox.html#demo2', 1280, 760, 'dark'),
        width: 1100,
        height: 653,
        dark: true,
      },
    ];
    for (const s of shots) await compose(screenshotPage(s), 1280, 800, s.file);

    const name = await worker.evaluate(() => chrome.i18n.getMessage('appName'));
    await compose(
      promoPage({
        name,
        tagline: text.tagline,
        icon: `data:image/png;base64,${icon.toString('base64')}`,
      }),
      440,
      280,
      'promo-440x280.png'
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const langs = process.argv.slice(2);
  const unknown = langs.filter((l) => !LANGS.includes(l));
  if (unknown.length) {
    console.error(`Unknown language: ${unknown.join(', ')}`);
    console.error(`Fix: pnpm store-assets [${LANGS.join('] [')}]`);
    process.exit(1);
  }
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const icon = padded(128, 16);
    fs.writeFileSync(path.join(OUT, 'icon-128.png'), icon);
    for (const lang of langs.length ? langs : LANGS) {
      await assetsFor(lang, icon);
      console.log(`Wrote store/${lang}/`);
    }
  } catch (error) {
    console.error(`Error: ${/** @type {Error} */ (error).message}`);
    console.error(
      'Fix: install Chromium for Playwright (pnpm exec playwright install chromium), then rerun'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
