// @vitest-environment jsdom
/**
 * The real service worker and a real page, wired through a fake `chrome`, to
 * catch races between page actions, worker replies, and storage events.
 */
import { vi } from 'vitest';
import { emptyInbox, ingest, markRead } from '../extension/src/lib/inbox.js';
import { emptySchedule } from '../extension/src/lib/schedule.js';
import { defaultSettings } from '../extension/src/lib/settings.js';
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
    /** @type {HTMLButtonElement} */ (
      document.querySelector('#detail button[title="Mark unread"]')
    ).click();
    await settle(150);
    expect(fake.stored.inbox.concerts[id].read).toBe(false);
    expect(fake.sent.filter((m) => m.type === 'read')).toEqual([
      { type: 'read', id, read: false },
    ]);
  });
});

describe('options page', () => {
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
