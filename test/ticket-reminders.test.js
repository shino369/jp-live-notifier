/** Run the real worker against Chrome lifecycle events and a controlled clock. */
import { vi } from 'vitest';
import { emptyInbox, ingest, markAllRead } from '../extension/src/lib/inbox.js';
import { fakeChrome, settle } from './fake-chrome.js';

const alarmName = 'ticket-reminder';
const lead = Date.parse('2099-02-11T10:00:00Z');
const start = Date.parse('2099-02-12T10:00:00Z');
const hour = 3_600_000;

function purchase() {
  const {
    state: inbox,
    created: [id],
  } = ingest(emptyInbox(), {
    keyword: 'ヨルシカ',
    listings: [
      {
        site: 'eplus',
        siteId: 'future-live',
        url: 'https://eplus.jp/future-live',
        title: 'ヨルシカ LIVE',
        performers: ['ヨルシカ'],
        venue: '日本武道館',
        prefecture: '東京都',
        dates: ['2099-02-11', '2099-02-12'],
        time: '17:00',
        saleLabel: null,
        saleStart: null,
        saleEnd: null,
        image: null,
      },
    ],
    now: '2099-02-01T00:00:00Z',
  });
  inbox.concerts[id].ticket = { date: '2099-02-12', time: '19:00' };
  return { inbox, id };
}

/** @param {Record<string, unknown>} data */
async function worker(data) {
  vi.resetModules();
  const fake = fakeChrome({ data });
  /** @type {Map<string, chrome.alarms.AlarmCreateInfo>} */
  const scheduled = new Map();
  const chromeMock = {
    ...fake.chrome,
    alarms: {
      ...fake.chrome.alarms,
      /** @param {string} name @param {chrome.alarms.AlarmCreateInfo} info */
      create: async (name, info) => {
        scheduled.set(name, info);
      },
      /** @param {string} name */
      clear: async (name) => scheduled.delete(name),
    },
    notifications: {
      ...fake.chrome.notifications,
      getAll: vi.fn(async () => /** @type {Record<string, boolean>} */ ({})),
      create: vi.fn(
        async (
          /** @type {string} */ id,
          /** @type {chrome.notifications.NotificationOptions} */ _options
        ) => id
      ),
    },
    tabs: {
      ...fake.chrome.tabs,
      create: vi.fn(
        async (/** @type {chrome.tabs.CreateProperties} */ _details) =>
          undefined
      ),
    },
  };
  const startup = vi.spyOn(chromeMock.runtime.onStartup, 'addListener');
  const idle = vi.spyOn(chromeMock.idle.onStateChanged, 'addListener');
  const alarm = vi.spyOn(chromeMock.alarms.onAlarm, 'addListener');
  const click = vi.spyOn(chromeMock.notifications.onClicked, 'addListener');
  const idleState = vi.spyOn(chromeMock.idle, 'queryState');
  vi.stubGlobal('chrome', chromeMock);
  await import('../extension/src/background.js');

  return {
    ...fake,
    chrome: chromeMock,
    scheduled,
    idleState,
    startup: async () => {
      await startup.mock.calls[0][0]();
      await settle(0);
    },
    active: async () => {
      idle.mock.calls[0][0]('active');
      await settle(0);
    },
    ring: async () => {
      scheduled.delete(alarmName);
      alarm.mock.calls[0][0]({ name: alarmName });
      await settle(0);
    },
    openReminder: async (/** @type {string} */ id) => {
      await click.mock.calls[0][0](id);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('defers a due reminder while locked, then repeats until the Japanese start time', async () => {
  const { inbox, id } = purchase();
  vi.setSystemTime(lead - hour);
  const app = await worker({ inbox });
  const notifications = app.chrome.notifications.create;
  await app.startup();
  expect(notifications).not.toHaveBeenCalled();
  expect(app.scheduled.get(alarmName)).toMatchObject({ when: lead });

  app.idleState.mockResolvedValue('locked');
  vi.setSystemTime(lead);
  await app.ring();
  expect(notifications).not.toHaveBeenCalled();

  app.idleState.mockResolvedValue('active');
  vi.setSystemTime(lead + hour);
  await Promise.all([app.active(), app.startup()]);
  expect(notifications).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    expect.objectContaining({
      message: expect.stringMatching(/ヨルシカ LIVE.*19:00 JST/),
    })
  );
  await app.openReminder(notifications.mock.calls[0][0]);
  expect(app.chrome.tabs.create).toHaveBeenCalledWith({
    url: `chrome-extension://test/src/ui/inbox.html#${id}`,
  });
  expect(app.scheduled.get(alarmName)).toMatchObject({ when: lead + 4 * hour });

  vi.setSystemTime(lead + 4 * hour);
  await app.ring();
  expect(notifications).toHaveBeenCalledTimes(2);

  vi.setSystemTime(start);
  await app.ring();
  await app.active();
  expect(notifications).toHaveBeenCalledTimes(2);
  expect(app.scheduled.has(alarmName)).toBe(false);
});

test('restarts preserve the last reminder and turning reminders off clears the alarm', async () => {
  const { inbox } = purchase();
  vi.setSystemTime(lead);
  const first = await worker({ inbox });
  await first.startup();
  expect(first.chrome.notifications.create).toHaveBeenCalledTimes(1);

  vi.setSystemTime(lead + hour);
  const afterRestart = await worker(first.stored);
  await afterRestart.startup();
  expect(afterRestart.chrome.notifications.create).not.toHaveBeenCalled();
  expect(afterRestart.scheduled.get(alarmName)).toMatchObject({
    when: lead + 3 * hour,
  });
  expect(
    await afterRestart.chrome.runtime.sendMessage({
      type: 'changeSettings',
      change: { type: 'set', key: 'ticketReminderHours', value: 0 },
    })
  ).toMatchObject({ ok: true });
  expect(afterRestart.scheduled.has(alarmName)).toBe(false);

  vi.setSystemTime(lead + 4 * hour);
  await afterRestart.active();
  expect(afterRestart.chrome.notifications.create).not.toHaveBeenCalled();
});

test('editing a performance reschedules it, and undo cancels the new reminder', async () => {
  const { inbox, id } = purchase();
  vi.setSystemTime(lead);
  const app = await worker({ inbox });
  await app.startup();
  const notifications = app.chrome.notifications.create;
  expect(notifications).toHaveBeenCalledTimes(1);

  const change = (
    /** @type {{ date: string, time: string } | null} */ ticket
  ) => app.chrome.runtime.sendMessage({ type: 'setTicket', id, ticket });
  expect(await change({ date: '2099-02-12', time: '19:00' })).toMatchObject({
    ok: true,
  });
  expect(notifications).toHaveBeenCalledTimes(1);
  expect(await change({ date: '2099-02-12', time: '21:00' })).toMatchObject({
    ok: true,
  });
  expect(app.scheduled.get(alarmName)).toMatchObject({ when: lead + 2 * hour });

  expect(await change(null)).toMatchObject({ ok: true });
  vi.setSystemTime(lead + 2 * hour);
  await app.ring();
  expect(notifications).toHaveBeenCalledTimes(1);
  expect(app.scheduled.has(alarmName)).toBe(false);
});

test('a failed storage write postpones delivery until the reminder can be recorded', async () => {
  const { inbox } = purchase();
  vi.setSystemTime(lead);
  const app = await worker({ inbox });
  const notifications = app.chrome.notifications.create;
  vi.spyOn(app.chrome.storage.local, 'set').mockRejectedValueOnce(
    new Error('storage temporarily unavailable')
  );
  await app.startup();
  expect(notifications).not.toHaveBeenCalled();
  expect(app.scheduled.get(alarmName)).toMatchObject({ when: lead + 60_000 });

  vi.setSystemTime(lead + 60_000);
  await app.ring();
  expect(notifications).toHaveBeenCalledTimes(1);
  await app.active();
  expect(notifications).toHaveBeenCalledTimes(1);
});

test('Clear read preserves a purchase outside the confirmed selection', async () => {
  const { inbox, id } = purchase();
  const ordinary = { ...inbox.concerts[id], id: 'ordinary', ticket: null };
  inbox.concerts[ordinary.id] = ordinary;
  vi.setSystemTime(start);
  const app = await worker({ inbox: markAllRead(inbox) });
  expect(
    await app.chrome.runtime.sendMessage({
      type: 'clearRead',
      ids: [ordinary.id],
    })
  ).toMatchObject({ ok: true, result: 1 });
  expect(Object.keys(app.stored.inbox.concerts)).toEqual([id]);
});

test('Chrome restarts before a pending reminder has been displayed', async () => {
  const { inbox } = purchase();
  vi.setSystemTime(start - hour);
  const beforeRestart = await worker({ inbox });
  beforeRestart.chrome.notifications.create.mockImplementation(
    () => new Promise(() => {})
  );
  await beforeRestart.startup();
  expect(beforeRestart.chrome.notifications.create).toHaveBeenCalledTimes(1);

  vi.setSystemTime(start - hour + 60_000);
  const afterRestart = await worker(beforeRestart.stored);
  await afterRestart.startup();
  expect(afterRestart.chrome.notifications.create).toHaveBeenCalledTimes(1);
  expect(afterRestart.chrome.notifications.create.mock.calls[0][0]).toBe(
    beforeRestart.chrome.notifications.create.mock.calls[0][0]
  );
  await afterRestart.active();
  expect(afterRestart.chrome.notifications.create).toHaveBeenCalledTimes(1);
});

test('a visible reminder is acknowledged after its receipt write fails', async () => {
  const { inbox } = purchase();
  vi.setSystemTime(lead);
  const original = await worker({ inbox });
  const { local } = original.chrome.storage;
  const save = local.set;
  vi.spyOn(local, 'set')
    .mockImplementationOnce(save)
    .mockRejectedValueOnce(new Error('receipt temporarily unavailable'));
  await original.startup();
  expect(original.chrome.notifications.create).toHaveBeenCalledTimes(1);

  const app = await worker(original.stored);
  app.chrome.notifications.getAll.mockResolvedValue({
    [original.chrome.notifications.create.mock.calls[0][0]]: true,
  });
  vi.setSystemTime(lead + 60_000);
  await app.startup();
  expect(app.chrome.notifications.create).not.toHaveBeenCalled();
  expect(app.scheduled.get(alarmName)).toMatchObject({ when: lead + 3 * hour });
});

test('saving a ticket reports failure if the concert was deleted in another tab', async () => {
  const { inbox, id } = purchase();
  const app = await worker({ inbox });
  await app.chrome.runtime.sendMessage({ type: 'delete', ids: [id] });
  expect(
    await app.chrome.runtime.sendMessage({
      type: 'setTicket',
      id,
      ticket: { date: '2099-02-12', time: '19:00' },
    })
  ).toMatchObject({ ok: false });
});
