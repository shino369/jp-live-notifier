// @vitest-environment jsdom
/**
 * The real service worker and a real page, wired through a fake `chrome`, to
 * catch races between page actions, worker replies, and storage events.
 */
import { vi } from 'vitest';
import { emptyInbox, ingest, markRead } from '../extension/src/lib/inbox.js';
import { emptySchedule } from '../extension/src/lib/schedule.js';
import { defaultSettings } from '../extension/src/lib/settings.js';
import { thumbKey } from '../extension/src/lib/thumbs.js';
import { ADAPTERS } from '../extension/src/sites/index.js';
import { fakeChrome, loadPage, settle } from './fake-chrome.js';

/**
 * @param {string} page
 * @param {string} module
 * @param {Parameters<typeof fakeChrome>[0]} options
 */
async function open(page, module, options) {
  vi.resetModules();
  // Never reach a real site from a test.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline')))
  );
  const fake = fakeChrome(options);
  /** @type {any} */ (globalThis).chrome = fake.chrome;
  loadPage(page);
  await import('../extension/src/background.js');
  await import(/* @vite-ignore */ module);
  await settle();
  return fake;
}

/** @param {string} id @param {boolean} checked */
function toggle(id, checked) {
  const box = /** @type {HTMLInputElement} */ (document.getElementById(id));
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inbox page', () => {
  test('mark unread stays unread when the storage event beats the reply', async () => {
    const { state, created } = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [
        {
          site: 'eplus',
          siteId: '1',
          url: 'https://eplus.jp/x',
          title: 'ヨルシカ LIVE',
          performers: ['ヨルシカ'],
          venue: '日本武道館',
          prefecture: '東京都',
          dates: ['2099-12-05'],
          time: '18:00',
          saleLabel: null,
          saleStart: null,
          saleEnd: null,
          image: null,
        },
      ],
      now: '2026-11-17T09:00:00.000Z',
      baseline: true,
    });
    const [id] = created;
    history.replaceState(null, '', `#${id}`);
    const fake = await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      data: {
        settings: { ...defaultSettings(), keywords: ['ヨルシカ'] },
        inbox: markRead(state, id),
      },
      // The worker answers late: its storage event reaches the page first.
      replyDelayMs: 30,
    });
    expect(document.querySelector('#detail h1')?.textContent).toBe(
      'ヨルシカ LIVE'
    );
    const unreadDot = () =>
      document.querySelector('#list .row .trail [aria-label="Unread"]');
    expect(unreadDot()).toBeNull();
    /** @type {HTMLButtonElement} */ (
      document.querySelector('#detail button[title="Mark unread"]')
    ).click();
    await settle(150);
    expect(fake.stored.inbox.concerts[id].read).toBe(false);
    // The unread dot sits beside the time, not in the leading inset.
    expect(unreadDot()?.classList.contains('badge-small')).toBe(true);
    expect(fake.sent.filter((m) => m.type === 'read')).toEqual([
      { type: 'read', id, read: false },
    ]);
  });
});

describe('inbox artist link', () => {
  test('clicking the artist above the title searches the list for it', async () => {
    /** @param {string} keyword @param {string} siteId */
    const show = (keyword, siteId) => ({
      site: 'eplus',
      siteId,
      url: `https://eplus.jp/${siteId}`,
      title: `${keyword} LIVE ${siteId}`,
      performers: [keyword],
      venue: `会場${siteId}`,
      prefecture: '東京都',
      dates: [`2099-12-0${siteId}`],
      time: '18:00',
      saleLabel: null,
      saleStart: null,
      saleEnd: null,
      image: null,
    });
    let inbox = emptyInbox();
    /** @type {string[]} */
    const ids = [];
    for (const [keyword, siteId] of [
      ['ヨルシカ', '1'],
      ['キタニタツヤ', '2'],
      ['ヨルシカ', '3'],
    ]) {
      const r = ingest(inbox, {
        keyword,
        listings: [show(keyword, siteId)],
        now: '2026-11-17T09:00:00.000Z',
        baseline: true,
      });
      inbox = r.state;
      ids.push(...r.created);
    }
    history.replaceState(null, '', `#${ids[0]}`);
    await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      data: {
        settings: {
          ...defaultSettings(),
          keywords: ['ヨルシカ', 'キタニタツヤ'],
        },
        inbox,
      },
    });
    const rows = () => document.querySelectorAll('#list .row').length;
    expect(rows()).toBe(3);
    const artist = /** @type {HTMLButtonElement} */ (
      document.querySelector('#detail .d-keywords button')
    );
    expect(artist.textContent).toBe('ヨルシカ');
    expect(artist.title).toBe('Show notifications for ヨルシカ');
    artist.click();
    await settle();
    expect(
      /** @type {HTMLInputElement} */ (document.getElementById('search')).value
    ).toBe('ヨルシカ');
    expect(rows()).toBe(2);
    // The open notification stays open.
    expect(document.querySelector('#detail h1')?.textContent).toBe(
      'ヨルシカ LIVE 1'
    );
  });
});

describe('inbox poster', () => {
  const IMG = 'https://livepocket.jp/public/event_image/x.webp';
  const concertWithImage = () => {
    const { state, created } = ingest(emptyInbox(), {
      keyword: 'ヨルシカ',
      listings: [
        {
          site: 'livepocket',
          siteId: 'p1',
          url: 'https://livepocket.jp/e/p1',
          title: 'ヨルシカ 座談会',
          performers: [],
          venue: null,
          prefecture: null,
          dates: ['2099-12-05'],
          time: null,
          saleLabel: null,
          saleStart: null,
          saleEnd: null,
          image: IMG,
        },
      ],
      now: '2026-11-17T09:00:00.000Z',
      baseline: true,
    });
    history.replaceState(null, '', `#${created[0]}`);
    return markRead(state, created[0]);
  };
  const poster = () =>
    /** @type {HTMLImageElement | null} */ (
      document.querySelector('#detail img.d-image')
    );

  test('shows the stored copy when there is one', async () => {
    await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      data: {
        settings: { ...defaultSettings(), keywords: ['ヨルシカ'] },
        inbox: concertWithImage(),
        [thumbKey(IMG)]: 'data:image/webp;base64,aGk=',
      },
    });
    expect(poster()?.getAttribute('src')).toBe('data:image/webp;base64,aGk=');
  });

  test('falls back to the URL, then a placeholder; a copy stored later replaces it', async () => {
    const fake = await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      data: {
        settings: { ...defaultSettings(), keywords: ['ヨルシカ'] },
        inbox: concertWithImage(),
      },
    });
    expect(poster()?.getAttribute('src')).toBe(IMG);
    poster()?.dispatchEvent(new Event('error'));
    expect(poster()).toBeNull();
    const placeholder = document.querySelector('#detail .d-poster-missing');
    expect(placeholder?.getAttribute('role')).toBe('img');
    expect(placeholder?.getAttribute('aria-label')).toBe(
      'Poster not available'
    );

    // A re-render (the schedule changes on every job) keeps the placeholder
    // at once and does not ask for the failed image again.
    await fake.chrome.storage.local.set({
      schedule: { ...emptySchedule(), lastRunAt: 1 },
    });
    expect(poster()).toBeNull();
    expect(document.querySelector('#detail .d-poster-missing')).not.toBeNull();
    await settle();
    expect(poster()).toBeNull();

    await fake.chrome.storage.local.set({
      [thumbKey(IMG)]: 'data:image/webp;base64,aGk=',
    });
    await settle();
    expect(poster()?.getAttribute('src')).toBe('data:image/webp;base64,aGk=');
  });
});

describe('options page', () => {
  test('credits the illustrations as unofficial fan art', async () => {
    await open('ui/options.html', '../extension/src/ui/options.js', {
      data: { settings: defaultSettings() },
    });
    // As rendered: markup line breaks collapse to spaces.
    const credits = (
      document.querySelector('footer.credits')?.textContent ?? ''
    ).replace(/\s+/g, ' ');
    // The 魔法少女ノ魔女裁判 fan-work guidelines (§9) ask for this notice in
    // the work itself.
    expect(credits).toContain('unofficial fan-made work');
    // §6: works made with generative AI must say so.
    expect(credits).toContain('AI利用');
    expect(credits).toContain('Acacia');
  });

  test('a blocked site shows its error, the pause, and a link inside the hint sentence', async () => {
    const now = Date.now();
    await open('ui/options.html', '../extension/src/ui/options.js', {
      data: {
        settings: defaultSettings(),
        schedule: {
          ...emptySchedule(),
          sites: {
            livepocket: {
              lastRequestAt: now,
              cooldownUntil: now + 14.5 * 60_000,
              failures: 1,
              lastOkAt: null,
              lastError: 'HTTP 202 (challenge)',
              lastCount: null,
            },
          },
        },
      },
    });
    const row = /** @type {HTMLElement} */ (
      document.getElementById('site-livepocket')?.closest('li')
    );
    const status = /** @type {HTMLElement} */ (
      row.querySelector('.supporting')
    );
    expect(status.querySelector('.error-text')?.textContent).toBe(
      'HTTP 202 (challenge) · retry in 15 min'
    );
    expect(status.textContent).toContain(
      'Open the site once to pass its check, then Check now.'
    );
    const link = status.querySelector('a');
    expect(link?.textContent).toBe('Open the site once');
    expect(link?.getAttribute('href')).toBe('https://livepocket.jp/');
    // The placeholder that marks the link's place never shows.
    expect(status.textContent).not.toContain('');
  });

  test('sites whose terms forbid automated access start off, with the warning shown', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: { settings: defaultSettings() },
      }
    );
    for (const a of ADAPTERS) {
      const box = /** @type {HTMLInputElement} */ (
        document.getElementById(`site-${a.id}`)
      );
      const row = /** @type {HTMLElement} */ (box.closest('li'));
      const warning = row.querySelector('.site-terms');
      expect(box.checked, a.id).toBe(!a.optIn);
      if (!a.optIn) {
        expect(warning, a.id).toBeNull();
        continue;
      }
      expect(warning?.textContent).toMatch(/terms forbid automated access/);
      expect(warning?.querySelector('a')?.getAttribute('href')).toBe(
        a.optIn.terms
      );
      // Read with the switch by screen readers, before it is flipped.
      expect(box.getAttribute('aria-describedby')).toBe(warning?.id);
    }
    toggle('site-zaiko', true);
    await settle();
    expect(fake.stored.settings.sites).toMatchObject({ zaiko: true });
    expect(
      /** @type {HTMLInputElement} */ (document.getElementById('site-zaiko'))
        .checked
    ).toBe(true);
  });

  test('two quick setting changes both persist', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: { settings: { ...defaultSettings(), keywords: ['ヨルシカ'] } },
        replyDelayMs: 5,
      }
    );
    toggle('notify', false);
    toggle('tabFallback', true);
    await settle();
    expect(fake.stored.settings).toMatchObject({
      notify: false,
      tabFallback: true,
      keywords: ['ヨルシカ'],
    });
  });

  test('removing one keyword while adding another keeps both changes', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        // Every site off, so adding a keyword queues no requests.
        data: {
          settings: {
            ...defaultSettings(),
            keywords: ['A', 'B'],
            sites: Object.fromEntries(ADAPTERS.map((a) => [a.id, false])),
          },
        },
        replyDelayMs: 5,
      }
    );
    const input = /** @type {HTMLTextAreaElement} */ (
      document.getElementById('new')
    );
    input.value = 'C';
    document
      .getElementById('add')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    /** @type {HTMLButtonElement} */ (
      document.querySelector('button[title="Remove A"]')
    ).click();
    await settle();
    expect(fake.stored.settings.keywords).toEqual(['B', 'C']);
  });
});

describe('illustrations', () => {
  test('Hidden turns them off on the page; Your image stores a fitted copy', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: { settings: defaultSettings() },
      }
    );
    const root = document.documentElement;
    const select = /** @type {HTMLSelectElement} */ (
      document.getElementById('decor')
    );
    expect(select.value).toBe('default');
    expect(root.dataset.decor).toBe('default');
    expect(document.getElementById('decor-custom')?.hidden).toBe(true);

    const input = /** @type {HTMLInputElement} */ (
      document.getElementById('decor-file')
    );
    const picker = vi.spyOn(input, 'click').mockImplementation(() => {});

    select.value = 'none';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(fake.stored.decor).toEqual({ mode: 'none', image: null });
    // Saved by the page itself: a worker still running older code (the
    // extension not yet reloaded) would drop the message.
    expect(fake.sent).toEqual([]);
    expect(picker).not.toHaveBeenCalled();
    expect(root.dataset.decor).toBe('none');
    expect(root.style.getPropertyValue('--deco-image')).toBe('none');

    // "Your image" with none stored opens the file picker at once.
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(picker).toHaveBeenCalledTimes(1);
    expect(document.getElementById('decor-custom')?.hidden).toBe(false);
    // No image yet: the default picture stays.
    expect(root.dataset.decor).toBe('default');

    // A 1200 × 600 picture over 1 MB is stored at 600 × 300.
    /** @type {number[][]} */
    const canvases = [];
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 1200,
      height: 600,
      close: () => {},
    }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        /** @param {number} w @param {number} h */
        constructor(w, h) {
          canvases.push([w, h]);
        }
        getContext() {
          return { drawImage: () => {} };
        }
        async convertToBlob() {
          return { arrayBuffer: async () => new Uint8Array([104, 105]).buffer };
        }
      }
    );
    Object.defineProperty(input, 'files', {
      value: [
        new File([new Uint8Array(1_100_000)], 'me.png', { type: 'image/png' }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(50);
    expect(document.getElementById('decor-msg')?.textContent).toMatch(
      /over 1 MB.*600 px.*no animation/i
    );
    const image = {
      url: 'data:image/webp;base64,aGk=',
      width: 600,
      height: 300,
    };
    expect(canvases).toEqual([[600, 300]]);
    expect(fake.stored.decor).toEqual({ mode: 'custom', image });
    expect(select.value).toBe('custom');
    expect(document.getElementById('decor-custom')?.hidden).toBe(false);
    expect(document.getElementById('decor-choose')?.textContent).toBe(
      'Replace image'
    );
    expect(root.dataset.decor).toBe('custom');
    expect(root.style.getPropertyValue('--deco-ratio')).toBe('600 / 300');

    // Back to the default keeps the image for later.
    select.value = 'default';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(fake.stored.decor).toEqual({ mode: 'default', image });
    expect(root.style.getPropertyValue('--deco-image')).toBe('');
  });

  test('a small file is kept as uploaded, so a GIF stays animated', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: { settings: defaultSettings() },
      }
    );
    const canvas = vi.fn();
    vi.stubGlobal('OffscreenCanvas', canvas);
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 320,
      height: 240,
      close: () => {},
    }));
    const input = /** @type {HTMLInputElement} */ (
      document.getElementById('decor-file')
    );
    Object.defineProperty(input, 'files', {
      value: [new File(['GIF89a'], 'cat.gif', { type: 'image/gif' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(50);
    expect(canvas).not.toHaveBeenCalled();
    expect(fake.stored.decor).toEqual({
      mode: 'custom',
      image: { url: 'data:image/gif;base64,R0lGODlh', width: 320, height: 240 },
    });
  });

  test('a file that is not an image says so and keeps the choice', async () => {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: { settings: defaultSettings() },
      }
    );
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('not an image');
    });
    const input = /** @type {HTMLInputElement} */ (
      document.getElementById('decor-file')
    );
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'notes.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(50);
    expect(document.getElementById('decor-msg')?.textContent).toMatch(
      /Could not read that image/
    );
    expect(fake.stored.decor).toBeUndefined();
  });

  test('the inbox fits a custom image into its corner box', async () => {
    await open('ui/inbox.html', '../extension/src/ui/inbox.js', {
      data: {
        settings: defaultSettings(),
        decor: {
          mode: 'custom',
          image: { url: 'data:image/png;base64,aGk=', width: 400, height: 800 },
        },
      },
    });
    const style = document.documentElement.style;
    expect(document.documentElement.dataset.decor).toBe('custom');
    expect(style.getPropertyValue('--deco-image')).toBe(
      'url("data:image/png;base64,aGk=")'
    );
    expect(style.getPropertyValue('--deco-fit')).toBe('115px 230px');
  });
});

describe('options page keyword editor', () => {
  /** Open the page with keywords A and B and every site off (no requests). */
  async function openEditor() {
    const fake = await open(
      'ui/options.html',
      '../extension/src/ui/options.js',
      {
        data: {
          settings: {
            ...defaultSettings(),
            keywords: ['A', 'B'],
            sites: Object.fromEntries(ADAPTERS.map((a) => [a.id, false])),
          },
          // Already stored, so a save that changes nothing fires no event.
          schedule: emptySchedule(),
        },
      }
    );
    /** @type {HTMLButtonElement} */ (
      document.querySelector('#keywords li button[title="Edit A"]')
    ).click();
    await settle();
    return fake;
  }

  const editor = () =>
    /** @type {HTMLInputElement | null} */ (
      document.querySelector('#keywords input')
    );

  /** @param {Partial<KeyboardEventInit>} init */
  const press = (init) =>
    editor()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init })
    );

  test('a storage-driven render keeps the text being typed', async () => {
    const fake = await openEditor();
    const input = /** @type {HTMLInputElement} */ (editor());
    input.value = 'A typed';
    input.dispatchEvent(new Event('input'));

    // A polling job writes the schedule while the user types.
    await fake.chrome.storage.local.set({ schedule: { queue: [], log: [] } });
    await settle();

    expect(editor()?.value).toBe('A typed');
  });

  test('Enter that confirms Japanese IME input does not save', async () => {
    const fake = await openEditor();
    /** @type {HTMLInputElement} */ (editor()).value = 'ヨルシカ';
    press({ isComposing: true });
    await settle();

    expect(fake.sent.filter((m) => m.type === 'changeSettings')).toEqual([]);
    expect(editor()).not.toBeNull();
  });

  test('Enter with an unchanged name closes the editor', async () => {
    const fake = await openEditor();
    press({});
    await settle();

    expect(editor()).toBeNull();
    expect(fake.stored.settings.keywords).toEqual(['A', 'B']);
  });

  test('Enter saves the rename', async () => {
    const fake = await openEditor();
    /** @type {HTMLInputElement} */ (editor()).value = 'C';
    press({});
    await settle();

    expect(fake.stored.settings.keywords).toEqual(['C', 'B']);
    expect(editor()).toBeNull();
  });
});
