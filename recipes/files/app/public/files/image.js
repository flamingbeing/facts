// Pictures, before they are stored: upright (the camera's orientation applied), at most maxDim on the long side, plus a
// thumbnail at most thumbDim, re-encoded as webp (jpeg where the browser can't write webp). Re-encoding drops the
// photo's EXIF, GPS included, so no place leaves the device by accident (exif.js reads what the app asked for first).
// Anything that is not a picture the browser can draw comes back null and is stored as it is.

/** @typedef {import('./types').ImageOptions} ImageOptions */

// never redrawn: vector and animated pictures would lose what they are
const KEEP = /^image\/(svg\+xml|gif)$/;

/** @param {number} w @param {number} h @param {number} max @returns {{ w: number, h: number }} the size that fits max */
export function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * @param {Blob} file
 * @param {ImageOptions} [o]
 * @returns {Promise<{ blob: Blob, thumb: Blob, w: number, h: number, type: string } | null>}
 */
export async function prepareImage(file, { maxDim = 2048, thumbDim = 320, type = 'image/webp', quality = 0.85 } = {}) {
  if (!/^image\//.test(file.type) || KEEP.test(file.type) || typeof createImageBitmap !== 'function') return null;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
  try {
    const big = await encode(bmp, fit(bmp.width, bmp.height, maxDim), type, quality);
    const thumb = await encode(bmp, fit(bmp.width, bmp.height, thumbDim), big.type, quality);
    const { w, h } = fit(bmp.width, bmp.height, maxDim);
    return { blob: big, thumb, w, h, type: big.type };
  } finally { bmp.close?.(); }
}

/** @param {ImageBitmap} bmp @param {{ w: number, h: number }} size @param {string} type @param {number} quality @returns {Promise<Blob>} */
async function encode(bmp, { w, h }, type, quality) {
  const out = await draw(bmp, w, h, type, quality);
  if (out.type === type) return out;
  // the browser wrote another type (Safari writes png for webp): jpeg, which every browser writes
  return draw(bmp, w, h, 'image/jpeg', quality);
}

/** @param {ImageBitmap} bmp @param {number} w @param {number} h @param {string} type @param {number} quality @returns {Promise<Blob>} */
async function draw(bmp, w, h, type, quality) {
  const flat = type === 'image/jpeg';   // no transparency in jpeg: white, not black, behind it
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(w, h), g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
    if (flat) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(bmp, 0, 0, w, h);
    return c.convertToBlob({ type, quality });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  if (flat) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(bmp, 0, 0, w, h);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('files: the picture could not be encoded')), type, quality));
}
