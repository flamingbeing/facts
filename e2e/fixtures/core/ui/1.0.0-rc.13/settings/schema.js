// @core/settings, the option list: what the app allows, and which value wins. Pure (no storage, no page), so the unit
// tests drive it directly.
//
// options: { key: { scope: 'device' | 'account' (default 'device'), default (default false: a new option is off),
//                   clean(v) -> the cleaned value, or undefined to refuse it (default: the default's own type),
//                   portable (account only, default true): false keeps it out of the settings file }
// profiles: { id: { label, defaults: { key: value } } }, a profile's own defaults for some options.
// A value is the saved one, else the active profile's default, else the option's default.

export const KEY = /^[a-z][A-Za-z0-9]{0,39}$/;
export const PROFILE_ID = /^[a-z][a-z0-9-]{0,19}$/;
// names the account's record already uses for itself
export const RESERVED = new Set(['id', 'profile', 'updatedAt', 'serverAt', 'createdAt']);

/** @param {unknown} a @param {unknown} b */
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The cleaner for a plain default: a value of the same type, a string no longer than 200 characters.
 * @param {unknown} def @returns {((v: unknown) => unknown) | null} */
function cleanerFor(def) {
  if (typeof def === 'boolean') return v => (typeof v === 'boolean' ? v : undefined);
  if (typeof def === 'number') return v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (typeof def === 'string') return v => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  return null;
}

/**
 * @typedef {object} Spec
 * @property {string} key
 * @property {'device' | 'account'} scope
 * @property {unknown} default
 * @property {(v: unknown) => unknown} clean
 * @property {boolean} portable
 */

/** Check the app's options and profiles once, at module creation, so a typo fails at start and not on a phone.
 * @param {{ options?: Record<string, any>, profiles?: Record<string, any> }} o */
export function compile({ options, profiles = {} } = {}) {
  if (!options || typeof options !== 'object' || !Object.keys(options).length) throw new Error('settings needs options');
  /** @type {Map<string, Spec>} */
  const specs = new Map();
  for (const [key, o] of Object.entries(options)) {
    if (!KEY.test(key) || RESERVED.has(key)) throw new Error(`settings: bad option name ${JSON.stringify(key)}`);
    const opt = o && typeof o === 'object' ? o : {};
    const scope = opt.scope ?? 'device';
    if (scope !== 'device' && scope !== 'account') throw new Error(`settings: ${key} scope is device or account`);
    const def = 'default' in opt ? opt.default : false;
    const clean = typeof opt.clean === 'function' ? opt.clean : cleanerFor(def);
    if (!clean) throw new Error(`settings: ${key} needs clean (its default is not a boolean, number or string)`);
    if (clean(def) === undefined) throw new Error(`settings: ${key}'s default fails its own clean`);
    specs.set(key, { key, scope, default: def, clean, portable: scope === 'account' && opt.portable !== false });
  }
  /** @type {Map<string, { id: string, label: string, defaults: Record<string, unknown> }>} */
  const profs = new Map();
  for (const [id, p] of Object.entries(profiles)) {
    if (!PROFILE_ID.test(id)) throw new Error(`settings: bad profile id ${JSON.stringify(id)}`);
    /** @type {Record<string, unknown>} */
    const defaults = {};
    for (const [key, v] of Object.entries(p?.defaults || {})) {
      const spec = specs.get(key);
      if (!spec) throw new Error(`settings: profile ${id} names ${key}, which is not an option`);
      const c = spec.clean(v);
      if (c === undefined) throw new Error(`settings: profile ${id}'s ${key} fails its clean`);
      defaults[key] = c;
    }
    profs.set(id, { id, label: String(p?.label ?? id), defaults });
  }
  // every option a profile governs: choosing a profile clears the saved values of these
  const governed = new Set([...profs.values()].flatMap(p => Object.keys(p.defaults)));
  return { specs, profiles: profs, governed };
}

/** @typedef {ReturnType<typeof compile>} Config */

/** A saved value cleaned again on the way out (a copy from another device may be junk); null and junk count as unset.
 * @param {Spec} spec @param {unknown} v */
export function savedValue(spec, v) {
  if (v === undefined || v === null) return undefined;
  return spec.clean(v);
}

/** The value in force.
 * @param {Config} cfg @param {string} key @param {unknown} saved  the saved value (undefined: none)
 * @param {string | null} profile  the active profile's id */
export function valueOf(cfg, key, saved, profile) {
  const spec = /** @type {Spec} */ (cfg.specs.get(key));
  if (saved !== undefined) return saved;
  const p = profile ? cfg.profiles.get(profile) : null;
  return p && key in p.defaults ? p.defaults[key] : spec.default;
}

/** True when a saved value differs from what the active profile gives, so the person has made it "Custom".
 * @param {Config} cfg @param {string | null} profile @param {(key: string) => unknown} savedOf */
export function isCustom(cfg, profile, savedOf) {
  const p = profile ? cfg.profiles.get(profile) : null;
  if (!p) return false;
  for (const key of cfg.governed) {
    const saved = savedOf(key);
    if (saved !== undefined && !same(saved, valueOf(cfg, key, undefined, profile))) return true;
  }
  return false;
}
