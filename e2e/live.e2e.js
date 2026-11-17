/**
 * Live smoke test against the real ticket sites (no mocks). Skipped unless
 * LIVE=1. Adds four artists, waits for the first round, and prints each
 * site's health and what was found. About 30 requests in total.
 *
 *   LIVE=1 pnpm exec playwright test -c tasks/live-notifier-261117/extension/playwright.config.js live
 */
import { chromium, expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const EXT = path.resolve(import.meta.dirname, '../extension');

test.skip(!process.env.LIVE, 'set LIVE=1 to hit the real sites');

test('first round against the real sites', async () => {
  test.setTimeout(300_000);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-notifier-live-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  if (process.env.DUMP) {
    let n = 0;
    context.on('response', async (r) => {
      if (!r.url().includes('livepocket.jp/event/search')) return;
      const body = await r.text().catch((e) => `ERR ${e}`);
      const file = path.resolve(EXT, `../tmp/live-resp-${++n}.html`);
      fs.writeFileSync(file, body);
      console.log(
        'RESP',
        n,
        r.status(),
        r.headers()['x-amzn-waf-action'] ?? '',
        body.length,
        (body.match(/event-card-list__item/g) ?? []).length,
        r.request().serviceWorker() ? 'sw' : 'page',
        decodeURIComponent(r.url()).slice(30, 60)
      );
    });
  }
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  // TAB=1 turns on the background-tab fallback for bot-checked sites.
  await worker.evaluate(async (tab) => {
    await chrome.storage.local.set({
      settings: { keywords: [], tabFallback: tab },
    });
  }, Boolean(process.env.TAB));
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/src/ui/options.html`
  );
  await page.fill(
    '#new',
    (
      process.env.KEYWORDS ?? 'ヨルシカ\nBUMP OF CHICKEN\nback number\n花譜'
    ).replaceAll('\\n', '\n')
  );
  await page.click('form#add button[type=submit]');
  // Done when every job left belongs to a site that is cooling down.
  const pending = () =>
    worker.evaluate(async () => {
      /** @type {{ schedule?: import('../extension/src/lib/schedule.js').ScheduleState }} */
      const { schedule } = await chrome.storage.local.get('schedule');
      const now = Date.now();
      if (Object.keys(schedule?.sites ?? {}).length < 6) return -1;
      const sites = schedule?.sites ?? {};
      return (schedule?.queue ?? []).filter(
        (j) => !((sites[j.site]?.cooldownUntil ?? 0) > now)
      ).length;
    });
  await expect.poll(pending, { timeout: 240_000, intervals: [2_000] }).toBe(0);
  /** @type {{ inbox?: import('../extension/src/lib/inbox.js').InboxState, schedule: import('../extension/src/lib/schedule.js').ScheduleState }} */
  const { inbox, schedule } = await worker.evaluate(() =>
    chrome.storage.local.get(['inbox', 'schedule'])
  );
  const concerts = Object.values(inbox?.concerts ?? {});
  const report = {
    sites: Object.fromEntries(
      Object.entries(schedule.sites).map(([id, h]) => [
        id,
        h.lastError
          ? `ERROR ${h.lastError}`
          : `ok, ${h.lastCount} match(es) last job`,
      ])
    ),
    log: schedule.log.map(
      (e) => `${e.site} ${e.keyword}: ${e.kind} ${e.count ?? e.error}`
    ),
    concerts: concerts.length,
    multiSite: concerts.filter(
      (c) => new Set(c.offers.map((o) => o.site)).size > 1
    ).length,
    sample: concerts
      .slice(0, 12)
      .map(
        (c) =>
          `${c.keywords.join(',')} | ${c.title} | ${c.dates.join('..')} | ${c.venue ?? '-'} | ${[...new Set(c.offers.map((o) => o.site))].join('+')}`
      ),
  };
  if (process.env.DUMP) {
    // Save what the extension's own fetch sees for each site (debugging).
    const urls = await worker.evaluate(() => ({
      livepocket:
        'https://livepocket.jp/event/search?word=%E3%83%A8%E3%83%AB%E3%82%B7%E3%82%AB&sort=3',
      ltike:
        'https://l-tike.com/search/?keyword=%E3%83%A8%E3%83%AB%E3%82%B7%E3%82%AB&sort=2&order=desc',
    }));
    for (const [site, url] of Object.entries(urls)) {
      const got = await worker.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          return {
            status: r.status,
            waf: r.headers.get('x-amzn-waf-action'),
            body: await r.text(),
          };
        } catch (e) {
          return { status: -1, waf: null, body: String(e) };
        }
      }, url);
      fs.writeFileSync(
        path.resolve(EXT, `../tmp/live-dump-${site}.html`),
        got.body
      );
      console.log(site, got.status, got.waf, got.body.length);
    }
  }
  fs.writeFileSync(
    path.resolve(EXT, '../tmp/live-report.json'),
    JSON.stringify({ report, concerts }, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  await context.close();
});
