/**
 * Chromium with the unpacked extension and a chosen UI language, which is
 * the language chrome.i18n picks the catalog by.
 *
 * Playwright's own launch cannot do this on macOS: Chromium there takes its
 * UI language from `-AppleLanguages (ja)`, not `--lang`, and Playwright
 * refuses that argument. So Chromium is started here, on a DevTools port it
 * picks itself, and Playwright connects over CDP.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const wait = (/** @type {number} */ ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ extension: string, lang: string, scale?: number, offline?: boolean }} options
 *   `extension`: the unpacked extension folder; `lang`: e.g. 'en', 'ja';
 *   `offline`: no host name resolves, so neither the pages nor the service
 *   worker can reach a site (extension pages and data: URLs still load)
 * @returns {Promise<{
 *   context: import('@playwright/test').BrowserContext,
 *   worker: import('@playwright/test').Worker,
 *   id: string,
 *   close: () => Promise<void>,
 * }>}
 */
export async function launchInLocale({
  extension,
  lang,
  scale = 1,
  offline = false,
}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `oshi-${lang}-`));
  const proc = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--force-device-scale-factor=${scale}`,
      '--no-first-run',
      // Chrome 137+ ignores --load-extension without this.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      `--lang=${lang}`,
      ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : []),
      ...(process.platform === 'darwin'
        ? ['-AppleLanguages', `(${lang})`]
        : []),
    ],
    { stdio: 'ignore', env: { ...process.env, LANGUAGE: lang, LANG: lang } }
  );
  const close = async () => {
    proc.kill();
    await wait(300);
    fs.rmSync(profile, { recursive: true, force: true });
  };
  try {
    // Chromium writes the port it picked to the profile.
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = '';
    for (let i = 0; i < 80 && !port; i++) {
      await wait(250);
      if (fs.existsSync(portFile))
        port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    }
    if (!port) throw new Error('Chromium did not open a DevTools port');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    // Chromium's built-in extensions have workers too; take ours.
    const ours = (/** @type {import('@playwright/test').Worker} */ w) =>
      w.url().endsWith('/src/background.js');
    const worker =
      context.serviceWorkers().find(ours) ??
      (await context.waitForEvent('serviceworker', {
        predicate: ours,
        timeout: 15_000,
      }));
    const ui = await worker.evaluate(() =>
      chrome.i18n.getMessage('@@ui_locale')
    );
    if (!ui.startsWith(lang))
      throw new Error(`Chromium's UI language is ${ui}, not ${lang}`);
    return {
      context,
      worker,
      id: new URL(worker.url()).host,
      close: async () => {
        await browser.close().catch(() => {});
        await close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
