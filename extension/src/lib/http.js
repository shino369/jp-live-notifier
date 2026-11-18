/**
 * Response handling shared by every adapter: charset-aware decoding (some JP
 * sites still serve Shift_JIS or EUC-JP) and detection of block or challenge
 * pages, so a blocked site cools down instead of looking like "no results".
 */

/**
 * The charset from a Content-Type header, else from a `<meta charset>` /
 * `<meta http-equiv>` in the first 2 KB, else UTF-8.
 *
 * @param {Uint8Array} bytes
 * @param {string | null} contentType
 * @returns {string}
 */
export function sniffCharset(bytes, contentType) {
  const header = /charset=["']?([\w-]+)/i.exec(contentType ?? '');
  if (header) return header[1].toLowerCase();
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 2048));
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

/**
 * @param {ArrayBuffer | Uint8Array} body
 * @param {string | null} contentType
 * @returns {string}
 */
export function decode(body, contentType) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const charset = sniffCharset(bytes, contentType);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const CHALLENGE = [
  /<title>\s*Just a moment/i,
  /cf-chl-|challenge-platform/i,
  /_Incapsula_Resource|Incapsula incident/i,
  /px-captcha|perimeterx/i,
  /Access Denied<\/h1>|Reference #\d+\.[0-9a-f]+/i,
  /アクセスが集中|ただいまアクセスが混み合って/,
  /<title>[^<]*(?:403|Forbidden)/i,
  /awsWafCookieDomainList|AwsWafIntegration/,
];

/**
 * Whether a response is a block: 403/429/503, an AWS WAF challenge (202 with
 * `x-amzn-waf-action`, LivePocket), or a challenge/queue page served with 200.
 *
 * @param {number} status
 * @param {string} text
 * @param {(name: string) => string | null} [header] response header getter
 * @returns {string | null} a short reason, or null when it looks fine
 */
export function blockReason(status, text, header = () => null) {
  if (status === 403 || status === 429 || status === 503)
    return `HTTP ${status}`;
  const waf = header('x-amzn-waf-action');
  if (waf) return `AWS WAF ${waf}`;
  if (status === 202 && text.length < 5_000) return 'HTTP 202 (challenge)';
  const head = text.slice(0, 20_000);
  const hit = CHALLENGE.find((re) => re.test(head));
  return hit ? `challenge page (${hit.source.slice(0, 24)})` : null;
}

/**
 * Rename inline event handler attributes (`onclick=` → `data-onclick=`).
 * Chrome checks the page's CSP for each one even in a DOMParser document,
 * where nothing runs, and logs every refused handler as an extension error.
 * No adapter reads them, and renaming keeps every quote and tag intact.
 *
 * @param {string} html
 * @returns {string}
 */
export const inertHandlers = (html) =>
  html.replace(
    /(\s)(on[a-z]+\s*=)/gi,
    (_, space, attr) => `${space}data-${attr.toLowerCase()}`
  );
