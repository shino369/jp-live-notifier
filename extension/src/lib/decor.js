/**
 * The pages' illustration: the default pictures, none, or the user's own
 * image. Kept under its own storage key (`decor`), apart from the settings
 * the worker reads on every job, since the image is a data URL.
 */

export const DECOR_KEY = 'decor';

/** Where each page fits a custom image, in CSS px (see each page's CSS). */
export const DECOR_BOXES = /** @type {const} */ ({
  inbox: [200, 230],
  popup: [180, 207],
  options: [300, 300],
});

/** Longest side of a stored custom image. */
export const DECOR_PX = 600;

/** A data URL longer than this is refused (a kept 1 MB file is ~1.4 MB). */
const MAX_URL = 2_000_000;

const MODES = /** @type {const} */ (['default', 'none', 'custom']);

/**
 * @typedef {{ url: string, width: number, height: number }} DecorImage
 * @typedef {{ mode: typeof MODES[number], image: DecorImage | null }} Decor
 * @typedef {{ mode?: Decor['mode'], image?: DecorImage | null }} DecorChange
 */

/** Only base64 image data URLs: the URL ends up inside CSS `url("…")`. */
const DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/**
 * @param {unknown} raw
 * @returns {DecorImage | null}
 */
function normalizeImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { url, width, height } = /** @type {Record<string, unknown>} */ (raw);
  const size = (/** @type {unknown} */ n) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (
    typeof url !== 'string' ||
    url.length > MAX_URL ||
    !DATA_URL.test(url) ||
    !size(width) ||
    !size(height)
  )
    return null;
  return {
    url,
    width: /** @type {number} */ (width),
    height: /** @type {number} */ (height),
  };
}

/**
 * @param {unknown} raw
 * @returns {Decor}
 */
export function normalizeDecor(raw) {
  const r = /** @type {Record<string, unknown>} */ (
    raw && typeof raw === 'object' ? raw : {}
  );
  return {
    mode: MODES.includes(/** @type {any} */ (r.mode))
      ? /** @type {Decor['mode']} */ (r.mode)
      : 'default',
    image: normalizeImage(r.image),
  };
}

/**
 * One edit from the settings page; the image stays when only the mode
 * changes, so switching back to "your image" needs no new upload.
 *
 * @param {Decor} decor
 * @param {DecorChange} change
 * @returns {Decor}
 */
export const applyDecorChange = (decor, change) =>
  normalizeDecor({ ...decor, ...change });

/**
 * What a page applies: `data-decor` on the root element and these CSS
 * variables. A custom image is fitted into the page's box (its width and
 * height in CSS px); "custom" without an image shows the default.
 *
 * @param {Decor} decor
 * @param {[number, number]} box
 * @returns {{ mode: Decor['mode'], vars: Record<string, string> }}
 */
export function decorView(decor, [boxW, boxH]) {
  if (decor.mode === 'none')
    return { mode: 'none', vars: { '--deco-image': 'none' } };
  const { image } = decor;
  if (decor.mode !== 'custom' || !image) return { mode: 'default', vars: {} };
  const scale = Math.min(boxW / image.width, boxH / image.height);
  return {
    mode: 'custom',
    vars: {
      '--deco-image': `url("${image.url}")`,
      '--deco-fit': `${Math.round(image.width * scale)}px ${Math.round(image.height * scale)}px`,
      '--deco-ratio': `${image.width} / ${image.height}`,
    },
  };
}
