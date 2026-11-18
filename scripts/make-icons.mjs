#!/usr/bin/env node
/**
 * Draw the toolbar/notification icon (a white eighth note on a red rounded
 * square) as PNGs at 16/32/48/128 px. No dependencies: raw RGBA + zlib.
 * Usage: node scripts/make-icons.mjs [outDir]
 *
 * `padded(128, 16)` is the Chrome Web Store icon: the artwork at 96 px in a
 * transparent 128 px square, as the store's image guidelines ask.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import zlib from 'zlib';

const RED = [217, 48, 37];

/** @param {number} n */
function crcTable(n) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
}
const TABLE = Array.from({ length: 256 }, (_, n) => crcTable(n));
/** @param {Buffer} buf */
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Coverage of a pixel by the shape, 4×4 supersampled. @param {number} size */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 128;
  const inRounded = (/** @type {number} */ x, /** @type {number} */ y) => {
    const r = 28 * s;
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inNote = (/** @type {number} */ x, /** @type {number} */ y) => {
    const u = x / s;
    const v = y / s;
    const head = ((u - 52) / 17) ** 2 + ((v - 88) / 13) ** 2 <= 1;
    const stem = u >= 61 && u <= 70 && v >= 30 && v <= 88;
    const flag =
      u >= 61 &&
      v >= 30 &&
      v <= 62 &&
      u <= 70 + (v - 30) * 0.9 &&
      u <= 92 &&
      v <= 30 + (u - 61) * 0.55 + 14;
    return head || stem || flag;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const sx = x + (i + 0.5) / 4;
          const sy = y + (j + 0.5) / 4;
          if (inRounded(sx, sy)) {
            bg++;
            if (inNote(sx, sy)) fg++;
          }
        }
      }
      const a = bg / 16;
      const w = bg ? fg / bg : 0;
      const o = (y * size + x) * 4;
      px[o] = Math.round(RED[0] + (255 - RED[0]) * w);
      px[o + 1] = Math.round(RED[1] + (255 - RED[1]) * w);
      px[o + 2] = Math.round(RED[2] + (255 - RED[2]) * w);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/**
 * RGBA pixels as a PNG.
 *
 * @param {Buffer} px
 * @param {number} size
 */
function encode(px, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The icon filling a `size` square. @param {number} size */
export const png = (size) => encode(draw(size), size);

/**
 * The icon drawn `size - 2 * pad` wide, centred in a transparent `size` square.
 *
 * @param {number} size
 * @param {number} pad
 */
export function padded(size, pad) {
  const art = size - 2 * pad;
  const inner = draw(art);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < art; y++)
    inner.copy(
      px,
      ((y + pad) * size + pad) * 4,
      y * art * 4,
      (y + 1) * art * 4
    );
  return encode(px, size);
}

function main() {
  const out = path.resolve(
    process.argv[2] ??
      path.join(import.meta.dirname, '..', 'extension', 'icons')
  );
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const size of [16, 32, 48, 128])
      fs.writeFileSync(path.join(out, `icon${size}.png`), png(size));
    console.log(`Wrote icons to ${out}`);
  } catch (error) {
    console.error(`Error: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
