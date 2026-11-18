/**
 * Loads the unpacked extension in Chromium, serves saved fixtures for every
 * ticket site, and walks: add artists → first sync (baseline: unread, one
 * summary, no spam) → a new show appears on two sites → one grouped unread
 * notification → popup → inbox detail → settings and back → star → clear
 * read. Saves light and dark screenshots of each page to ../tmp/.
 *
 * The "new show" (【TEST】ヨルシカ ダミー公演 2027) is invented: it is injected
 * into the saved LivePocket and Pia pages and exists only in this test's
 * throwaway browser profile.
 */
import { chromium, expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const EXT = path.resolve(import.meta.dirname, '../extension');
const FIX = path.resolve(import.meta.dirname, '../test/fixtures');
const fixture = (/** @type {string} */ f) =>
  fs.readFileSync(path.join(FIX, f), 'utf-8');

const NEW_CARD = `<li class="event-card-list__item"><a class="event-card event-card" href="/e/test999"><div class="event-card__image-box"><span class="tag-primary event-card__tag">販売前</span></div><div class="event-card__info"><h3 class="event-card__title">【TEST】ヨルシカ ダミー公演 2027</h3><p class="event-card__text event-card__text--date"><span class="event-card__date">日程</span>2027年1月10日(日)</p><p class="event-card__text"><span class="event-card__time">時間</span>18:00〜</p><p class="event-card__text"><span class="event-card__place">会場</span>Kアリーナ横浜（神奈川県）</p></div></a></li>`;
const PIA_ITEM = `<section class="sales_data"><header class="sales_data_header"><h3 class="sales_data_title"><a href="http://t.pia.jp/pia/event/event.do?eventCd=9999999">【TEST】ヨルシカ ダミー公演 2027</a></h3></header><div class="event_link" itemscope itemtype="http://schema.org/Event"><a href="https://ticket.pia.jp/pia/ticketInformation.do?eventCd=9999999&rlsCd=002&lotRlsCd=" itemprop="url"><ul class="table_data"><li class="is_title">プレリザーブ／【TEST】ヨルシカ ダミー公演 2027</li><li class="is_date"><span class="dt"><time itemprop="startDate" datetime="2027-01-10T00:00:00+09:00"></time>2027/1/10(日)</span></li><li class="is_place" itemprop="location"><span itemprop="name">Ｋアリーナ横浜</span>(<span itemprop="address"><span itemprop="addressRegion">神奈川県</span></span>)</li><li class="is_status">受付中 ～2026/12/01(火) 23:59</li></ul></a></div></section>`;

let phase = 1;

/**
 * Save a light and a dark screenshot of a page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function shoot(page, name) {
  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    await page.emulateMedia({ colorScheme });
    // Let color transitions (switches) finish before the shot.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.resolve(EXT, `../tmp/e2e-${name}-${colorScheme}.png`),
      fullPage: name !== 'popup',
    });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** @type {Record<string, () => { body: string, type: string }>} */
const ROUTES = {
  'livepocket.jp': () => {
    const page = fixture('livepocket-yorushika.html');
    return {
      body:
        phase === 1
          ? page
          : page.replace(
              '<ul class="event-card-list">',
              `<ul class="event-card-list">${NEW_CARD}`
            ),
      type: 'text/html; charset=utf-8',
    };
  },
  't.pia.jp': () => {
    const page = fixture('pia-nohit-rlsInfo.html');
    return {
      body: phase === 1 ? page : `${PIA_ITEM}${page}`,
      type: 'text/html; charset=utf-8',
    };
  },
  'eplus.jp': () => ({
    body: fixture('eplus-noresult.html'),
    type: 'text/html; charset=utf-8',
  }),
  'l-tike.com': () => ({
    body: fixture('ltike-noresult.rendered-dom.html'),
    type: 'text/html; charset=utf-8',
  }),
  'ticket.rakuten.co.jp': () => ({
    body: fixture('rakuten-yorushika.html'),
    type: 'text/html; charset=UTF-8',
  }),
  'asobi-ticket.api.app.t-riple.com': () => ({
    body: fixture('asobi-booths.json'),
    type: 'application/json',
  }),
};

test('add artists, baseline, grouped notification, popup, inbox, star, clear', async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oshi-live-alert-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  /** @type {string[]} */
  const requested = [];
  await context.route(/^https:\/\//, async (route) => {
    const url = new URL(route.request().url());
    const handler = Object.entries(ROUTES).find(
      ([host]) => url.host === host
    )?.[1];
    requested.push(url.host);
    if (handler) {
      const { body, type } = handler();
      return route.fulfill({ status: 200, body, contentType: type });
    }
    // Sites without a fixture route (or images) get an empty no-hit page.
    return route.fulfill({
      status: 200,
      body: '<html><body></body></html>',
      contentType: 'text/html',
    });
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}/src/ui`;

  // The options page opens on install. LivePocket and ぴあ are opt-in (their
  // terms forbid bots); the new show appears on them, so turn them on first.
  const options = await context.newPage();
  await options.goto(`${base}/options.html`);
  for (const site of ['livepocket', 'pia']) {
    const box = options.locator(`#site-${site}`);
    await expect(box).not.toBeChecked();
    await expect(options.locator(`#site-${site}-terms a`)).toHaveAttribute(
      'href',
      /^https:\/\//
    );
    await box.check();
    await expect(box).toBeChecked();
  }
  // Add four artists in one paste.
  await options.fill(
    '#new',
    'ヨルシカ\nBUMP OF CHICKEN\nback number\n花譜\nヨルシカ'
  );
  await options.click('form#add button[type=submit]');
  await expect(options.locator('#keywords li span.kw')).toHaveText([
    'ヨルシカ',
    'BUMP OF CHICKEN',
    'back number',
    '花譜',
  ]);
  await expect(options.locator('#add-msg')).toContainText(
    'Already in the list: ヨルシカ'
  );

  // First sync is a baseline: the existing shows arrive unread, with one
  // summary notification instead of one per show.
  /** @returns {Promise<Pick<import('../extension/src/lib/inbox.js').InboxState, 'concerts'>>} */
  const inboxState = () =>
    worker.evaluate(
      async () =>
        /** @type {Record<string, any>} */ (
          await chrome.storage.local.get('inbox')
        ).inbox ?? { concerts: {} }
    );
  /** @returns {Promise<number>} */
  const queueLength = () =>
    worker.evaluate(
      async () =>
        /** @type {Record<string, any>} */ (
          await chrome.storage.local.get('schedule')
        ).schedule?.queue?.length ?? -1
    );
  await expect.poll(queueLength, { timeout: 90_000 }).toBe(0);
  const first = Object.values((await inboxState()).concerts);
  expect(first.length).toBeGreaterThan(0);
  expect(first.every((c) => !c.read)).toBe(true);
  expect(requested).toContain('livepocket.jp');
  const baselineNotes = Object.keys(
    await worker.evaluate(() => chrome.notifications.getAll())
  );
  expect(baselineNotes.length).toBeGreaterThan(0);
  expect(baselineNotes.every((k) => k.startsWith('summary:'))).toBe(true);
  await shoot(options, 'options');
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'readAll' }));

  // A new show appears on LivePocket and Pia: one grouped, unread concert.
  phase = 2;
  await options.click('#check');
  await expect
    .poll(
      async () =>
        Object.values((await inboxState()).concerts).filter((c) => !c.read)
          .length,
      { timeout: 90_000 }
    )
    .toBe(1);
  await expect.poll(queueLength, { timeout: 90_000 }).toBe(0);
  const fresh = Object.values((await inboxState()).concerts).find(
    (c) => !c.read
  );
  if (!fresh) throw new Error('no unread concert after the second check');
  expect(fresh.title).toBe('【TEST】ヨルシカ ダミー公演 2027');
  expect(fresh.offers.map((o) => o.site).sort()).toEqual(['livepocket', 'pia']);
  expect(fresh).toMatchObject({
    dates: ['2027-01-10'],
    venue: 'Kアリーナ横浜',
    prefecture: '神奈川県',
    time: '18:00',
  });
  const notes = await worker.evaluate(() => chrome.notifications.getAll());
  expect(Object.keys(notes).some((k) => k.startsWith(`c:${fresh.id}`))).toBe(
    true
  );
  expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('1');

  // Popup lists it; clicking opens the inbox on its detail.
  const popup = await context.newPage();
  await popup.goto(`${base}/popup.html`);
  const row = popup.locator(`.item[data-id="${fresh.id}"]`);
  await expect(row).toHaveClass(/unread/);
  await popup.setViewportSize({ width: 400, height: 600 });
  await shoot(popup, 'popup');
  const [inbox] = await Promise.all([
    context.waitForEvent('page'),
    row.click(),
  ]);
  await inbox.waitForLoadState();
  expect(inbox.url()).toContain(`inbox.html#${fresh.id}`);
  await expect(inbox.locator('#detail h1')).toHaveText(
    '【TEST】ヨルシカ ダミー公演 2027'
  );
  await expect(inbox.locator('#detail .offers .item')).toHaveCount(2);
  await expect(inbox.locator('#detail .facts')).toContainText(
    '2027/01/10 (Sun) 18:00'
  );
  await expect(inbox.locator('#detail .facts')).toContainText(
    'Kアリーナ横浜 · 神奈川県'
  );
  await expect(inbox.locator('#detail a.go').first()).toHaveAttribute(
    'href',
    /^https:\/\//
  );
  await expect
    .poll(async () => (await inboxState()).concerts[fresh.id].read)
    .toBe(true);
  await shoot(inbox, 'inbox');

  // A narrow window shows one pane: the detail with a back arrow to the list.
  await inbox.setViewportSize({ width: 600, height: 800 });
  await expect(inbox.locator('#list-pane')).toBeHidden();
  await shoot(inbox, 'inbox-narrow');
  await inbox.locator('#detail button[title="Back to the list"]').click();
  await expect(inbox.locator('#list-pane')).toBeVisible();
  await expect(inbox.locator('#detail')).toBeHidden();
  await inbox.setViewportSize({ width: 1280, height: 720 });
  await inbox.locator(`.row[data-id="${fresh.id}"]`).click();

  // Settings open in the same tab; the top app bar's back arrow returns.
  await inbox.locator('#tools button[title="Settings"]').click();
  await expect(inbox).toHaveURL(/options\.html\?from=inbox$/);
  await inbox.locator('#back').click();
  await expect(inbox).toHaveURL(new RegExp(`inbox\\.html#${fresh.id}$`));
  await expect(inbox.locator('#detail h1')).toHaveText(
    '【TEST】ヨルシカ ダミー公演 2027'
  );

  // Star it, then clear read: only unstarred read ones go.
  await inbox.locator('#detail .d-actions button[title^="Star"]').click();
  await expect
    .poll(async () => (await inboxState()).concerts[fresh.id].starred)
    .toBe(true);
  await inbox.locator('#tools button[title^="Clear read"]').click();
  await expect(inbox.locator('#clear-dialog')).toBeVisible();
  await inbox.locator('#clear-ok').click();
  await expect
    .poll(async () => Object.keys((await inboxState()).concerts))
    .toEqual([fresh.id]);
  await expect(inbox.locator('#list .row')).toHaveCount(1);

  // Unstar and delete inline; it does not come back on the next check.
  await inbox
    .locator(`.row[data-id="${fresh.id}"] button[title="Unstar"]`)
    .click();
  await inbox
    .locator(`.row[data-id="${fresh.id}"] button[title="Delete"]`)
    .click();
  await expect
    .poll(async () => Object.keys((await inboxState()).concerts))
    .toEqual([]);
  await options.click('#check');
  await expect.poll(queueLength, { timeout: 90_000 }).toBe(0);
  expect(Object.keys((await inboxState()).concerts)).toEqual([]);

  // Clicking a popup row closes the popup page; a fresh one shows the empty inbox.
  const after = await context.newPage();
  await after.goto(`${base}/popup.html`);
  await expect(after.locator('#list')).toContainText('No live info yet.');
  await context.close();
});
