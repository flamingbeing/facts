// What a photo says about itself, read before image.js re-encodes it (which drops it): the date taken, and the place
// only when the app asks (exif: { place: true }). Vendored exifr's lite build, loaded on first use only, so an app
// that never turns exif on never downloads it. A photo without EXIF, or one exifr can't read, gives {}.

/** @typedef {{ taken?: number, place?: { lat: number, lng: number } }} Exif */

/** @type {Promise<typeof import('../vendor/exifr/7.1.3/lite.esm.js')> | null} */
let lib = null;
const load = () => (lib ??= import('../vendor/exifr/7.1.3/lite.esm.js').catch(e => { lib = null; throw e; }));

/** @param {Blob} file @param {{ place?: boolean }} [o] @returns {Promise<Exif>} */
export async function readExif(file, { place = false } = {}) {
  if (!/^image\/(jpeg|heic|heif|tiff|png|webp)$/.test(file.type)) return {};
  try {
    const exifr = await load();
    const tags = await exifr.parse(await file.arrayBuffer(), { exif: true, gps: place });  // the lite build throws on `pick`
    if (!tags) return {};
    /** @type {Exif} */
    const out = {};
    const when = tags.DateTimeOriginal || tags.CreateDate;
    if (when instanceof Date && !isNaN(+when)) out.taken = +when;
    if (place && Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude)) out.place = { lat: tags.latitude, lng: tags.longitude };
    return out;
  } catch { return {}; }
}
