import { vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EXTENSION_ID,
  accessToken,
  describeStatus,
  main,
  parseKey,
  signJwt,
  storeClient,
  submit,
} from '../scripts/publish-store.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const PEM = /** @type {string} */ (
  privateKey.export({ type: 'pkcs8', format: 'pem' })
);
const KEY_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'cws-publisher@example.iam.gserviceaccount.com',
  private_key: PEM,
});
const PUBLISHER = '00000000-0000-4000-8000-000000000000';
const ITEM = `publishers/${PUBLISHER}/items/${EXTENSION_ID}`;
const API = 'https://chromewebstore.googleapis.com';

/**
 * A fetch that answers from a queue and records each request.
 *
 * @param {Array<{ status?: number, body?: unknown, text?: string }>} replies
 */
function fakeFetch(replies) {
  /** @type {Array<{ url: string, init: RequestInit }>} */
  const calls = [];
  const fetch = vi.fn(async (/** @type {string} */ url, init = {}) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request to ${url}`);
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status ?? 200 });
  });
  return { fetch, calls };
}

/** @param {string} jwt */
const decode = (jwt) =>
  jwt
    .split('.')
    .slice(0, 2)
    .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));

describe('publish-store', () => {
  test('parseKey reads the email and key, and never echoes the secret', () => {
    expect(parseKey(KEY_JSON)).toEqual({
      email: 'cws-publisher@example.iam.gserviceaccount.com',
      privateKey: PEM,
    });
    expect(() => parseKey(undefined)).toThrow(
      /CWS_SERVICE_ACCOUNT_KEY is not set/
    );
    expect(() => parseKey('')).toThrow(/not set/);
    // JSON.parse quotes the input in its message; ours must not.
    const broken = '{"private_key": "-----BEGIN SECRET';
    expect(() => parseKey(broken)).toThrow(/not valid JSON/);
    try {
      parseKey(broken);
    } catch (error) {
      expect(String(/** @type {Error} */ (error).message)).not.toContain(
        'BEGIN SECRET'
      );
    }
    expect(() => parseKey('{"client_email": "a@b"}')).toThrow(
      /client_email or private_key/
    );
    expect(() => parseKey('null')).toThrow(/client_email or private_key/);
  });

  test('signJwt signs an RS256 assertion for the Chrome Web Store scope', () => {
    const jwt = signJwt(parseKey(KEY_JSON), 1_700_000_000);
    const [header, claims] = decode(jwt);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toEqual({
      iss: 'cws-publisher@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const [h, c, signature] = jwt.split('.');
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        publicKey,
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true);
  });

  test('accessToken trades the signed assertion for a token', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { access_token: 'tok', expires_in: 3599 } },
    ]);
    const token = await accessToken(parseKey(KEY_JSON), {
      fetch,
      now: () => 1_700_000_000_500,
    });
    expect(token).toBe('tok');
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].init.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer'
    );
    expect(decode(String(form.get('assertion')))[1].iat).toBe(1_700_000_000);
  });

  test('accessToken reports the token endpoint error, or a missing token', async () => {
    const key = parseKey(KEY_JSON);
    const now = () => 0;
    await expect(
      accessToken(key, {
        fetch: fakeFetch([
          {
            status: 400,
            body: {
              error: 'invalid_grant',
              error_description: 'Invalid JWT Signature.',
            },
          },
        ]).fetch,
        now,
      })
    ).rejects.toThrow(
      /access token failed \(HTTP 400\): Invalid JWT Signature/
    );
    await expect(
      accessToken(key, {
        fetch: fakeFetch([{ status: 401, body: { error: 'unauthorized' } }])
          .fetch,
        now,
      })
    ).rejects.toThrow(/HTTP 401\): unauthorized/);
    await expect(
      accessToken(key, { fetch: fakeFetch([{ body: {} }]).fetch, now })
    ).rejects.toThrow(/no access_token/);
  });

  test('storeClient calls the v2 endpoints with the bearer token', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { itemId: EXTENSION_ID } },
      { body: { uploadState: 'SUCCEEDED', crxVersion: '0.1.3' } },
      { body: { state: 'PENDING_REVIEW' } },
    ]);
    const client = storeClient({ publisherId: PUBLISHER, token: 'tok', fetch });
    const zip = Buffer.from('PK zip bytes');
    expect(await client.status()).toEqual({ itemId: EXTENSION_ID });
    expect(await client.upload(zip)).toEqual({
      uploadState: 'SUCCEEDED',
      crxVersion: '0.1.3',
    });
    expect(await client.publish('STAGED_PUBLISH')).toEqual({
      state: 'PENDING_REVIEW',
    });
    expect(calls.map((c) => [c.init.method ?? 'GET', c.url])).toEqual([
      ['GET', `${API}/v2/${ITEM}:fetchStatus`],
      ['POST', `${API}/upload/v2/${ITEM}:upload`],
      ['POST', `${API}/v2/${ITEM}:publish`],
    ]);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(calls[1].init.body).toBe(zip);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      publishType: 'STAGED_PUBLISH',
    });
    expect(calls[2].init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  test('storeClient turns API errors into messages', async () => {
    const client = (/** @type {any[]} */ ...replies) =>
      storeClient({
        publisherId: PUBLISHER,
        token: 'tok',
        fetch: fakeFetch(replies).fetch,
      });
    await expect(
      client({
        status: 403,
        body: {
          error: { code: 403, message: 'The caller does not have permission' },
        },
      }).status()
    ).rejects.toThrow(
      /fetchStatus failed \(HTTP 403\): The caller does not have permission/
    );
    await expect(
      client({ status: 502, text: '<html>Bad Gateway</html>' }).upload(
        Buffer.from('')
      )
    ).rejects.toThrow(/upload failed \(HTTP 502\): <html>Bad Gateway/);
    await expect(
      client({ status: 500, body: { error: { code: 500 } } }).publish(
        'DEFAULT_PUBLISH'
      )
    ).rejects.toThrow(/publish failed \(HTTP 500\): \{"error"/);
    // An empty success body is an empty object, not a crash.
    expect(await client({ text: '' }).status()).toEqual({});
    expect(() =>
      storeClient({ publisherId: '../x', token: 't', fetch: vi.fn() })
    ).toThrow(/CWS_PUBLISHER_ID/);
  });

  /**
   * @param {Partial<Record<'upload' | 'status' | 'publish', any[]>>} replies
   */
  function fakeClient(replies) {
    const take = (/** @type {'upload' | 'status' | 'publish'} */ k) => {
      const list = replies[k] ?? [];
      if (list.length === 0) throw new Error(`unexpected ${k}`);
      const reply = list.shift();
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    };
    return {
      upload: vi.fn(() => take('upload')),
      status: vi.fn(() => take('status')),
      publish: vi.fn(() => take('publish')),
    };
  }

  test('submit uploads, then submits for review and prints the result', async () => {
    const client = fakeClient({
      upload: [{ uploadState: 'SUCCEEDED', crxVersion: '0.1.3' }],
      publish: [
        {
          state: 'PENDING_REVIEW',
          warningInfo: {
            warnings: [
              { reason: 'LONG_REVIEW', description: 'May take longer.' },
            ],
          },
        },
      ],
    });
    /** @type {string[]} */
    const out = [];
    const zip = Buffer.from('zip');
    const result = await submit(client, zip, {
      staged: false,
      sleep: vi.fn(),
      print: (s) => out.push(s),
    });
    expect(result.state).toBe('PENDING_REVIEW');
    expect(client.upload).toHaveBeenCalledWith(zip);
    expect(client.publish).toHaveBeenCalledWith('DEFAULT_PUBLISH');
    expect(out).toEqual([
      'Uploaded v0.1.3.',
      'Submitted for review (state: PENDING_REVIEW); it goes live once approved.',
      'Warning: LONG_REVIEW: May take longer.',
    ]);
  });

  test('submit waits while the upload is processed; staged waits for a manual publish', async () => {
    const client = fakeClient({
      upload: [{ uploadState: 'IN_PROGRESS' }],
      status: [
        { lastAsyncUploadState: 'IN_PROGRESS' },
        { lastAsyncUploadState: 'SUCCEEDED' },
      ],
      publish: [{ state: 'PENDING_REVIEW' }],
    });
    const sleep = vi.fn();
    /** @type {string[]} */
    const out = [];
    await submit(client, Buffer.from('zip'), {
      staged: true,
      sleep,
      print: (s) => out.push(s),
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(client.publish).toHaveBeenCalledWith('STAGED_PUBLISH');
    expect(out).toEqual([
      'Uploaded.',
      'Submitted for review (state: PENDING_REVIEW); once approved, publish it in the Developer Dashboard.',
    ]);
  });

  test('submit stops on a failed or stuck upload without publishing', async () => {
    const failed = fakeClient({ upload: [{ uploadState: 'FAILED' }] });
    await expect(
      submit(failed, Buffer.from(''), {
        staged: false,
        sleep: vi.fn(),
        print: vi.fn(),
      })
    ).rejects.toThrow(/upload ended as FAILED/);
    expect(failed.publish).not.toHaveBeenCalled();

    const stuck = fakeClient({
      upload: [{ uploadState: 'IN_PROGRESS' }],
      status: [{ lastAsyncUploadState: 'IN_PROGRESS' }, {}],
    });
    await expect(
      submit(stuck, Buffer.from(''), {
        staged: false,
        sleep: vi.fn(),
        print: vi.fn(),
        tries: 1,
      })
    ).rejects.toThrow(/still being processed after 5s/);

    const lost = fakeClient({
      upload: [{ uploadState: 'IN_PROGRESS' }],
      status: [{}],
    });
    await expect(
      submit(lost, Buffer.from(''), {
        staged: false,
        sleep: vi.fn(),
        print: vi.fn(),
      })
    ).rejects.toThrow(/upload ended as unknown/);
    expect(lost.publish).not.toHaveBeenCalled();
  });

  test('submit: a refused publish names the Dashboard and shows what the store kept', async () => {
    // Seen with v0.1.3: the upload succeeded, then publish answered 400
    // because the new idle permission had no justification in the
    // Dashboard, and the store kept the published version as the draft.
    const refused = new Error(
      'publish failed (HTTP 400): Your submission does not meet the requirements to be published in the store. Check the Developer Dashboard for steps to resolve.'
    );
    const client = fakeClient({
      upload: [{ uploadState: 'SUCCEEDED', crxVersion: '0.1.3' }],
      publish: [refused],
      status: [
        {
          publishedItemRevisionStatus: {
            state: 'PUBLISHED',
            distributionChannels: [
              { crxVersion: '0.1.2', deployPercentage: 100 },
            ],
          },
        },
      ],
    });
    /** @type {string[]} */
    const out = [];
    const error = await submit(client, Buffer.from('zip'), {
      staged: false,
      sleep: vi.fn(),
      print: (s) => out.push(s),
    }).catch((/** @type {Error} */ e) => e);
    expect(out).toEqual(['Uploaded v0.1.3.']);
    expect(error.message).toContain('publish failed (HTTP 400)');
    expect(error.message).toContain('the secrets work');
    expect(error.message).toContain('Published: PUBLISHED (v0.1.2 at 100%)');
    expect(error.message).toMatch(
      /Fix: .*Developer Dashboard.*justification under Privacy/
    );
    expect(error.message).toContain('Actions → Store → submit');
  });

  test('submit: a refused publish still explains itself when the status check fails too', async () => {
    const client = fakeClient({
      upload: [{ uploadState: 'SUCCEEDED' }],
      publish: [new Error('publish failed (HTTP 400): no')],
      status: [new Error('fetchStatus failed (HTTP 500): down')],
    });
    const error = await submit(client, Buffer.from('zip'), {
      staged: false,
      sleep: vi.fn(),
      print: vi.fn(),
    }).catch((/** @type {Error} */ e) => e);
    expect(error.message).toContain('publish failed (HTTP 400): no');
    expect(error.message).toContain(
      'Store state unknown (fetchStatus failed (HTTP 500): down)'
    );
    expect(error.message).toContain('Fix: ');
  });

  test('describeStatus lists the published and submitted versions and any policy flags', () => {
    expect(
      describeStatus({
        itemId: EXTENSION_ID,
        publishedItemRevisionStatus: {
          state: 'PUBLISHED',
          distributionChannels: [
            { crxVersion: '0.1.2', deployPercentage: 100 },
          ],
        },
        submittedItemRevisionStatus: { state: 'PENDING_REVIEW' },
      })
    ).toBe(
      [
        `Item ${EXTENSION_ID}`,
        'Published: PUBLISHED (v0.1.2 at 100%)',
        'Submitted: PENDING_REVIEW',
      ].join('\n')
    );
    expect(describeStatus({ takenDown: true, warned: true })).toBe(
      [
        `Item ${EXTENSION_ID}`,
        'Published: none',
        'Submitted: none',
        'Taken down for a policy violation: see the Developer Dashboard.',
        'Policy warning: resolve it in the Developer Dashboard, or the item will be taken down.',
      ].join('\n')
    );
    expect(
      describeStatus({
        publishedItemRevisionStatus: { distributionChannels: [] },
      })
    ).toContain('Published: unknown');
  });

  test('main: status checks the credentials end to end', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { access_token: 'tok' } },
      {
        body: {
          publishedItemRevisionStatus: {
            state: 'PUBLISHED',
            distributionChannels: [
              { crxVersion: '0.1.2', deployPercentage: 100 },
            ],
          },
        },
      },
    ]);
    /** @type {string[]} */
    const out = [];
    await main(['status'], {
      env: { CWS_SERVICE_ACCOUNT_KEY: KEY_JSON, CWS_PUBLISHER_ID: PUBLISHER },
      print: (s) => out.push(s),
      fetch,
      now: () => 0,
    });
    expect(calls[1].url).toBe(`${API}/v2/${ITEM}:fetchStatus`);
    expect(out.join('\n')).toContain('Published: PUBLISHED (v0.1.2 at 100%)');
  });

  test('main: submit reads the zip first, then uploads and submits it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-store-'));
    const zip = path.join(dir, 'oshi-live-alert-v0.1.3.zip');
    fs.writeFileSync(zip, 'PK zip');
    const { fetch, calls } = fakeFetch([
      { body: { access_token: 'tok' } },
      { body: { uploadState: 'SUCCEEDED', crxVersion: '0.1.3' } },
      { body: { state: 'PENDING_REVIEW' } },
    ]);
    /** @type {string[]} */
    const out = [];
    const env = {
      CWS_SERVICE_ACCOUNT_KEY: KEY_JSON,
      CWS_PUBLISHER_ID: PUBLISHER,
    };
    await main(['submit', zip, '--staged'], {
      env,
      print: (s) => out.push(s),
      fetch,
      now: () => 0,
      sleep: vi.fn(),
    });
    expect(String(calls[1].init.body)).toBe('PK zip');
    expect(JSON.parse(String(calls[2].init.body)).publishType).toBe(
      'STAGED_PUBLISH'
    );
    expect(out[0]).toBe('Uploaded v0.1.3.');

    // A missing zip fails before any request is made.
    const none = vi.fn();
    await expect(
      main(['submit', path.join(dir, 'missing.zip')], {
        env,
        print: vi.fn(),
        fetch: none,
      })
    ).rejects.toThrow(/ENOENT/);
    expect(none).not.toHaveBeenCalled();
  });

  test('main: bad arguments or settings fail before any request', async () => {
    const fetch = vi.fn();
    const io = (/** @type {Record<string, string>} */ env) => ({
      env,
      print: vi.fn(),
      fetch,
    });
    const ok = {
      CWS_SERVICE_ACCOUNT_KEY: KEY_JSON,
      CWS_PUBLISHER_ID: PUBLISHER,
    };
    await expect(main([], io(ok))).rejects.toThrow(/Usage/);
    await expect(main(['publish'], io(ok))).rejects.toThrow(/Usage/);
    await expect(main(['submit'], io(ok))).rejects.toThrow(/Usage/);
    await expect(main(['submit', 'a.zip', '--now'], io(ok))).rejects.toThrow(
      /Usage/
    );
    await expect(
      main(['status'], io({ CWS_SERVICE_ACCOUNT_KEY: KEY_JSON }))
    ).rejects.toThrow(/CWS_PUBLISHER_ID is not set/);
    await expect(
      main(['status'], io({ CWS_PUBLISHER_ID: PUBLISHER }))
    ).rejects.toThrow(/CWS_SERVICE_ACCOUNT_KEY is not set/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
