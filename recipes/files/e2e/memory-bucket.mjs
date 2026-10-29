// An in-memory stand-in for an R2 bucket binding (put, get, delete), for worker/files.js in the unit tests and the
// e2e server (e2e/serve.mjs). Only what files.js uses: put(key, body, { httpMetadata, customMetadata }),
// get(key) -> { body, size, httpMetadata, customMetadata } | null, delete(key | keys).
export function memoryBucket() {
  /** @type {Map<string, { bytes: Uint8Array, httpMetadata: object, customMetadata: object }>} */
  const objects = new Map();
  return {
    objects,
    async put(key, body, { httpMetadata = {}, customMetadata = {} } = {}) {
      const bytes = body == null ? new Uint8Array() : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, httpMetadata, customMetadata });
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { key, body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null;
    },
    async delete(keys) {
      for (const k of [].concat(keys)) objects.delete(k);
    },
  };
}
