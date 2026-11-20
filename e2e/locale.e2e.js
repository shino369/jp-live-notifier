/**
 * The three pages in each language the extension ships, in real Chromium
 * started with that UI language (chrome.i18n picks the catalog from it).
 * Demo data is written straight into storage, with every ticket site off so
 * nothing is fetched. The expected text is read from the catalog files (not
 * from Chrome), and a light and a dark screenshot of each page is saved to
 * ../tmp/e2e-<lang>-<page>-<scheme>.png.
 */
import { expect, test } from '@playwright/test';
import path from 'path';
import { fakeI18n } from '../test/fake-chrome.js';
import { launchInLocale } from './locale-browser.js';

const EXT = path.resolve(import.meta.dirname, '../extension');
const TMP = path.resolve(import.meta.dirname, '../tmp');

/** Demo inbox: an unread update, a selected show with two offers, a starred one. */
function demo() {
  const now = Date.now();
  const ago = (/** @type {number} */ min) =>
    new Date(now - min * 60_000).toISOString();
  /** @param {string} id @param {string} site @param {string} title @param {string} sale */
  const offer = (id, site, title, sale) => ({
    site,
    siteId: `${id}-${site}`,
    url: `https://example.invalid/${id}/${site}`,
    title,
    performers: [],
    venue: '日本武道館',
    prefecture: '東京都',
    dates: ['2099-02-11'],
    time: '18:00',
    saleLabel: sale,
    saleStart: null,
    saleEnd: null,
    image: null,
    firstSeenAt: ago(30),
    lastSeenAt: ago(1),
  });
  /** @param {string} id @param {string} artist @param {string} title @param {any[]} offers @param {object} [extra] */
  const concert = (id, artist, title, offers, extra = {}) => ({
    id,
    keywords: [artist],
    title,
    performers: [artist],
    venue: '日本武道館',
    prefecture: '東京都',
    dates: ['2099-02-11', '2099-02-12'],
    time: '18:00',
    image: null,
    offers,
    createdAt: ago(30),
    updatedAt: ago(4),
    read: true,
    starred: false,
    update: null,
    ...extra,
  });
  const concerts = [
    concert('demo1', 'ヨルシカ', 'ヨルシカ 公演 2099', [
      offer('demo1', 'eplus', 'ヨルシカ 公演 2099', '先行受付中'),
      offer('demo1', 'pia', 'ヨルシカ 公演 2099', 'プレリザーブ'),
    ]),
    concert(
      'demo2',
      '花譜',
      '花譜 ワンマン 2099',
      [offer('demo2', 'ltike', '花譜 ワンマン 2099', '一般発売')],
      {
        read: false,
        starred: true,
        dates: ['2099-02-11'],
        update: { key: 'updateAlsoOn', args: ['ローチケ'] },
      }
    ),
  ];
  const health = (/** @type {object} */ over) => ({
    lastRequestAt: now - 9 * 60_000,
    cooldownUntil: 0,
    failures: 0,
    lastOkAt: now - 9 * 60_000,
    lastError: null,
    lastCount: 1,
    ...over,
  });
  return {
    settings: {
      keywords: ['ヨルシカ', '花譜'],
      // Every site off: the worker must not reach a real site.
      sites: Object.fromEntries(
        ['eplus', 'ltike', 'pia', 'rakuten', 'livepocket', 'asobi'].map((s) => [
          s,
          false,
        ])
      ),
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
      sites: {
        eplus: health({}),
        livepocket: health({
          cooldownUntil: now + 14.5 * 60_000,
          failures: 1,
          lastOkAt: null,
          lastError: 'HTTP 202 (challenge)',
          lastCount: null,
        }),
      },
    },
  };
}

/** Message keys in camelCase (what t() shows when a message is missing). */
const KEY = /\b[a-z]+(?:[A-Z][a-z]+)+\b/;

for (const lang of ['en', 'ja']) {
  test(`pages in ${lang}`, async () => {
    const m = fakeI18n(lang);
    const msg = (/** @type {string} */ key, /** @type {string[]} */ ...args) =>
      m.getMessage(key, args);
    const browser = await launchInLocale({ extension: EXT, lang, scale: 2 });
    try {
      const { context, worker, id } = browser;
      await worker.evaluate(
        async (data) => chrome.storage.local.set(data),
        demo()
      );
      const page = await context.newPage();
      const base = `chrome-extension://${id}/src/ui`;
      /** @param {string} name */
      const shoot = async (name) => {
        for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
          await page.emulateMedia({ colorScheme });
          await page.waitForTimeout(400);
          await page.screenshot({
            path: path.join(TMP, `e2e-${lang}-${name}-${colorScheme}.png`),
            fullPage: name !== 'popup',
          });
        }
      };
      const noKeys = async () =>
        expect(await page.locator('body').innerText()).not.toMatch(KEY);

      // Popup.
      await page.setViewportSize({ width: 400, height: 600 });
      await page.goto(`${base}/popup.html`);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('h1')).toHaveText(msg('appName'));
      await expect(page.locator('#count')).toHaveText(msg('unreadCount', '1'));
      await expect(page.locator('#read-all')).toHaveText(msg('markAllRead'));
      await expect(page.locator('#list .update')).toHaveText(
        msg('updateAlsoOn', 'ローチケ')
      );
      await noKeys();
      await shoot('popup');

      // Inbox with a show selected (opening it marks it read).
      await page.setViewportSize({ width: 1280, height: 760 });
      await page.goto(`${base}/inbox.html#demo1`);
      await expect(page).toHaveTitle(msg('pageTitleInbox'));
      await expect(page.locator('#filters button').first()).toHaveText(
        msg('filterAll', '2')
      );
      await expect(page.locator('#detail h2').first()).toHaveText(
        msg('tickets', '2')
      );
      await expect(page.locator('#search')).toHaveAttribute(
        'placeholder',
        msg('searchNotifications')
      );
      await noKeys();
      await shoot('inbox');

      // Settings: the bot-checked site's row.
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`${base}/options.html`);
      await expect(page).toHaveTitle(msg('pageTitleSettings'));
      await expect(page.locator('h1')).toHaveText(msg('settings'));
      const row = page.locator('li', { has: page.locator('#site-livepocket') });
      await expect(row.locator('.error-text')).toHaveText(
        `${msg('errorChallenge')} · ${msg('siteRetryIn', '15')}`
      );
      await expect(row.locator('a').first()).toHaveText(msg('siteBlockedLink'));
      // LivePocket is opt-in: the warning links its terms.
      await expect(row.locator('.site-terms a')).toHaveText(
        msg('siteTermsLink')
      );
      await noKeys();
      await shoot('settings');

      await test.step('change the reminder interval', async () => {
        const reminders = page.getByRole('combobox', {
          name: msg('ticketReminderSetting'),
        });
        await expect(reminders).toHaveValue('3');
        await reminders.selectOption('6');
        await page.reload();
        await expect(reminders).toHaveValue('6');
      });

      await test.step('mark a ticket, find it in Going, and undo the mark', async () => {
        await page.clock.install({ time: new Date('2099-02-12T09:55:00Z') });
        await page.goto(`${base}/inbox.html#demo1`);
        const detail = page.locator('#detail');
        await detail.getByRole('button', { name: msg('ticketMark') }).click();
        const dialog = page.getByRole('dialog');
        const date = dialog.getByLabel(msg('ticketDate'));
        const time = dialog.getByLabel(msg('ticketTime'));
        await expect(date).toHaveValue('');
        await expect(time).toHaveValue('');
        await date.fill('2099-02-12');
        await dialog.getByRole('button', { name: msg('ticketSave') }).click();
        await expect(
          detail.getByText(msg('ticketBought'), { exact: true })
        ).toBeVisible();

        await page.reload();
        await page
          .getByRole('button', { name: msg('filterGoing', '1') })
          .click();
        const list = page.getByRole('listbox');
        await expect(list.getByRole('option')).toHaveCount(1);
        await expect(list.getByText(msg('ticketMissingStart'))).toBeVisible();
        await list.getByRole('option').click();
        await detail.getByRole('button', { name: msg('ticketEdit') }).click();
        await expect(date).toHaveValue('2099-02-12');
        await time.fill('19:00');
        await dialog.getByRole('button', { name: msg('ticketSave') }).click();
        await expect(list.getByText(msg('ticketMissingStart'))).toHaveCount(0);

        await detail.getByRole('button', { name: msg('ticketEdit') }).click();
        await expect(time).toHaveValue('19:00');
        await dialog.getByRole('button', { name: msg('cancel') }).click();
        await page.clock.fastForward(5 * 60_000);
        await expect(list.getByRole('option')).toHaveCount(0);

        await detail.getByRole('button', { name: msg('ticketEdit') }).click();
        await dialog.getByRole('button', { name: msg('ticketUndo') }).click();
        await expect(
          detail.getByRole('button', { name: msg('ticketMark') })
        ).toBeVisible();
      });

      await test.step('prefill the date but leave an unverified time blank', async () => {
        await page.goto(`${base}/inbox.html#demo2`);
        await page.getByRole('button', { name: msg('ticketMark') }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByLabel(msg('ticketDate'))).toHaveValue(
          '2099-02-11'
        );
        await expect(dialog.getByLabel(msg('ticketTime'))).toHaveValue('');
        await dialog.getByRole('button', { name: msg('cancel') }).click();
      });
    } finally {
      await browser.close();
    }
  });
}
