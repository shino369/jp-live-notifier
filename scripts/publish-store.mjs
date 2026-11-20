#!/usr/bin/env node
/**
 * Chrome Web Store submission (API v2), used by .github/workflows/release.yml
 * and .github/workflows/store.yml.
 *
 *   node scripts/publish-store.mjs status
 *       print the published and submitted versions (a safe credentials check)
 *   node scripts/publish-store.mjs submit <zip> [--staged]
 *       upload the zip, wait while the store processes it, and submit it for
 *       review. It goes live once approved; --staged holds it after approval
 *       until you publish it in the Developer Dashboard
 *
 * Env: CWS_SERVICE_ACCOUNT_KEY (the service account's JSON key, the whole
 * file) and CWS_PUBLISHER_ID (Developer Dashboard → Publisher → Settings).
 * The service account signs in with a signed JWT, so no client secret or
 * refresh token is needed. The store listing (texts, images) is not part of
 * the API: edit it in the dashboard.
 */
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const EXTENSION_ID = 'lnbkpklllnjdljbnjjinnklnpfbcpokl';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com';
const PUBLISHER_ID = /^[A-Za-z0-9-]+$/;
const USAGE =
  'Usage: node scripts/publish-store.mjs status | submit <zip> [--staged]';

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} Fetch */
/** @typedef {{ email: string, privateKey: string }} ServiceAccount */

/**
 * @param {string | undefined} text the JSON key file's contents
 * @returns {ServiceAccount}
 */
export function parseKey(text) {
  if (!text) throw new Error('CWS_SERVICE_ACCOUNT_KEY is not set');
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    // Not the parser's message: it quotes the input, which is a secret.
    throw new Error(
      'CWS_SERVICE_ACCOUNT_KEY is not valid JSON (store the whole key file)'
    );
  }
  if (
    typeof key?.client_email !== 'string' ||
    typeof key?.private_key !== 'string'
  )
    throw new Error(
      'CWS_SERVICE_ACCOUNT_KEY has no client_email or private_key (is it a service account key?)'
    );
  return { email: key.client_email, privateKey: key.private_key };
}

/** @param {string} text */
const base64url = (text) => Buffer.from(text).toString('base64url');

/**
 * A one-hour RS256 assertion asking for the Chrome Web Store scope.
 *
 * @param {ServiceAccount} key
 * @param {number} iat seconds since the epoch
 * @returns {string}
 */
export function signJwt({ email, privateKey }, iat) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat,
      exp: iat + 3600,
    })
  );
  const input = `${header}.${claims}`;
  const signature = crypto
    .sign('sha256', Buffer.from(input), privateKey)
    .toString('base64url');
  return `${input}.${signature}`;
}

/**
 * Send a request and parse the JSON reply; an HTTP error becomes an Error
 * with the API's own message.
 *
 * @param {Fetch} fetch
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} what names the call in the error
 * @returns {Promise<any>}
 */
async function request(fetch, url, init, what) {
  const response = await fetch(url, init);
  const text = await response.text();
  /** @type {any} */
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message =
      body?.error?.message ??
      body?.error_description ??
      (typeof body?.error === 'string' ? body.error : undefined) ??
      text.slice(0, 200);
    throw new Error(`${what} failed (HTTP ${response.status}): ${message}`);
  }
  return body ?? {};
}

/**
 * @param {ServiceAccount} key
 * @param {{ fetch: Fetch, now: () => number }} io
 * @returns {Promise<string>}
 */
export async function accessToken(key, { fetch, now }) {
  const reply = await request(
    fetch,
    TOKEN_URI,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signJwt(key, Math.floor(now() / 1000)),
      }).toString(),
    },
    'Getting an access token'
  );
  if (!reply.access_token)
    throw new Error('The token endpoint returned no access_token');
  return reply.access_token;
}

/**
 * @param {{ publisherId: string, token: string, fetch: Fetch }} options
 */
export function storeClient({ publisherId, token, fetch }) {
  if (!PUBLISHER_ID.test(publisherId))
    throw new Error(
      'CWS_PUBLISHER_ID must be the publisher ID from the Developer Dashboard (letters, digits, dashes)'
    );
  const item = `publishers/${publisherId}/items/${EXTENSION_ID}`;
  const auth = { Authorization: `Bearer ${token}` };
  return {
    status: () =>
      request(
        fetch,
        `${API}/v2/${item}:fetchStatus`,
        { headers: auth },
        'fetchStatus'
      ),
    /** @param {Uint8Array} zip */
    upload: (zip) =>
      request(
        fetch,
        `${API}/upload/v2/${item}:upload`,
        { method: 'POST', headers: auth, body: /** @type {BodyInit} */ (zip) },
        'upload'
      ),
    /** @param {'DEFAULT_PUBLISH' | 'STAGED_PUBLISH'} publishType */
    publish: (publishType) =>
      request(
        fetch,
        `${API}/v2/${item}:publish`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishType }),
        },
        'publish'
      ),
  };
}

/**
 * Upload the zip, wait while the store processes it, then submit it for
 * review. Nothing is submitted unless the upload succeeded.
 *
 * @param {{ upload: (zip: Uint8Array) => Promise<any>, status: () => Promise<any>, publish: (type: 'DEFAULT_PUBLISH' | 'STAGED_PUBLISH') => Promise<any> }} client
 * @param {Uint8Array} zip
 * @param {{ staged: boolean, sleep: (ms: number) => unknown, print: (s: string) => void, tries?: number, delayMs?: number }} options
 */
export async function submit(
  client,
  zip,
  { staged, sleep, print, tries = 60, delayMs = 5000 }
) {
  const upload = await client.upload(zip);
  let state = upload.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' && i < tries; i++) {
    await sleep(delayMs);
    state = (await client.status()).lastAsyncUploadState;
  }
  if (state === 'IN_PROGRESS')
    throw new Error(
      `The upload is still being processed after ${(tries * delayMs) / 1000}s. Fix: run Actions → Store → status later; if it succeeded, submit again`
    );
  if (state !== 'SUCCEEDED')
    throw new Error(`The upload ended as ${state ?? 'unknown'}`);
  print(upload.crxVersion ? `Uploaded v${upload.crxVersion}.` : 'Uploaded.');
  let result;
  try {
    result = await client.publish(
      staged ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH'
    );
  } catch (error) {
    // Only a 400 is the store refusing this package; an auth error, an
    // outage, or a network failure is rethrown as it is (retry, or check
    // the secrets).
    if (!/\(HTTP 400\)/.test(errorText(error))) throw error;
    throw new Error(await refusedPublish(client, error));
  }
  print(
    `Submitted for review (state: ${result.state ?? 'unknown'}); ${
      staged
        ? 'once approved, publish it in the Developer Dashboard.'
        : 'it goes live once approved.'
    }`
  );
  for (const warning of result.warningInfo?.warnings ?? [])
    print(`Warning: ${warning.reason}: ${warning.description}`);
  return result;
}

/**
 * The message for a publish the store refused after a successful upload.
 * The store's reply names no reason ("does not meet the requirements …"),
 * and it may keep the published version as the draft, so the message says
 * what the store holds now and where the reason is: the Dashboard, most
 * often a missing permission justification for a release that adds one.
 *
 * @param {{ status: () => Promise<any> }} client
 * @param {unknown} error
 * @returns {Promise<string>}
 */
async function refusedPublish(client, error) {
  let state;
  try {
    state = describeStatus(await client.status());
  } catch (statusError) {
    state = `Store state unknown (${errorText(statusError)})`;
  }
  return [
    errorText(error),
    'The upload was accepted, so the secrets work; the store refused to submit it for review.',
    state,
    'Fix: open the item in the Chrome Web Store Developer Dashboard. A release that adds a permission needs its justification under Privacy (see store/README.md); if the draft under Package is not this version, upload the release zip there to see what is missing. Then submit for review in the Dashboard, or run Actions → Store → submit with this tag.',
  ].join('\n');
}

/** @param {unknown} error */
const errorText = (error) =>
  String(/** @type {Error} */ (error)?.message ?? error);

/**
 * @param {any} revision an ItemRevisionStatus, or undefined
 * @returns {string}
 */
function describeRevision(revision) {
  if (!revision) return 'none';
  const channels = (revision.distributionChannels ?? [])
    .map((/** @type {any} */ c) => `v${c.crxVersion} at ${c.deployPercentage}%`)
    .join(', ');
  return `${revision.state ?? 'unknown'}${channels ? ` (${channels})` : ''}`;
}

/**
 * @param {any} status a fetchStatus reply
 * @returns {string}
 */
export function describeStatus(status) {
  return [
    `Item ${EXTENSION_ID}`,
    `Published: ${describeRevision(status.publishedItemRevisionStatus)}`,
    `Submitted: ${describeRevision(status.submittedItemRevisionStatus)}`,
    ...(status.takenDown
      ? ['Taken down for a policy violation: see the Developer Dashboard.']
      : []),
    ...(status.warned
      ? [
          'Policy warning: resolve it in the Developer Dashboard, or the item will be taken down.',
        ]
      : []),
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @param {{
 *   env: Record<string, string | undefined>,
 *   print: (s: string) => void,
 *   fetch?: Fetch,
 *   now?: () => number,
 *   sleep?: (ms: number) => unknown,
 * }} io
 */
export async function main(
  [command, ...args],
  {
    env,
    print,
    fetch = globalThis.fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
) {
  const files = args.filter((a) => !a.startsWith('--'));
  const flags = args.filter((a) => a.startsWith('--'));
  const valid =
    (command === 'status' && args.length === 0) ||
    (command === 'submit' &&
      files.length === 1 &&
      flags.every((f) => f === '--staged'));
  if (!valid) throw new Error(USAGE);
  if (!env.CWS_PUBLISHER_ID) throw new Error('CWS_PUBLISHER_ID is not set');
  const key = parseKey(env.CWS_SERVICE_ACCOUNT_KEY);
  // Read the zip before signing in, so a wrong path costs no request.
  const zip = command === 'submit' ? fs.readFileSync(files[0]) : undefined;
  const token = await accessToken(key, { fetch, now });
  const client = storeClient({
    publisherId: env.CWS_PUBLISHER_ID,
    token,
    fetch,
  });
  if (zip) {
    await submit(client, zip, {
      staged: flags.includes('--staged'),
      sleep,
      print,
    });
  } else {
    print(describeStatus(await client.status()));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), {
    env: process.env,
    print: (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`),
  }).catch((error) => {
    const message = String(/** @type {Error} */ (error).message ?? error);
    console.error(message);
    if (!message.startsWith('Usage') && !message.includes('Fix:'))
      console.error(
        'Fix: check the CWS_SERVICE_ACCOUNT_KEY and CWS_PUBLISHER_ID secrets, that the service account email is added under Account in the Developer Dashboard, and that the Chrome Web Store API is enabled in its Google Cloud project'
      );
    process.exit(1);
  });
}
