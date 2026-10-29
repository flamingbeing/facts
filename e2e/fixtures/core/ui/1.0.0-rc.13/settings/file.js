// @core/settings, the settings file: the account's preferences as one small JSON file, to move them to another account
// or share a setup. Pure. Same pattern as the sample it was ported from: a kind and a version, a cleaner per key,
// unknown keys and wrong shapes dropped, nothing that stays on a device (device options, and account options marked
// portable: false) ever written or read.
import { savedValue } from './schema.js';

export const KIND = 'core-settings';
export const VERSION = 1;
const MAX_JSON = 100 * 1024;

/** @typedef {import('./schema.js').Config} Config */

/** @param {Config} cfg @param {Record<string, unknown>} values  the saved account values @param {string | null} profile
 * @param {() => Date} [now] */
export function writeFile(cfg, values, profile, now = () => new Date()) {
  /** @type {Record<string, unknown>} */
  const settings = {};
  for (const spec of cfg.specs.values()) {
    if (!spec.portable) continue;
    const v = savedValue(spec, values[spec.key]);
    if (v !== undefined) settings[spec.key] = v;
  }
  return { kind: KIND, version: VERSION, exportedAt: now().toISOString(), ...(profile ? { profile } : {}), settings };
}

/** What a file may set: the portable options whose value passes their clean, and a profile the app has. Throws with a
 * plain sentence when the text is not a settings file at all.
 * @param {Config} cfg @param {string} text
 * @returns {{ settings: Record<string, unknown>, profile: string | null, dropped: string[] }} */
export function readFile(cfg, text) {
  if (String(text ?? '').length > MAX_JSON) throw new Error('That file is too big to be a settings file');
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('That isn’t a settings file (not JSON)'); }
  if (!d || typeof d !== 'object' || d.kind !== KIND) throw new Error('That isn’t a settings file from this app');
  if (d.version !== VERSION) throw new Error('That settings file is from a different version');
  if (!d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) throw new Error('The file has no settings');
  /** @type {Record<string, unknown>} */
  const settings = {};
  /** @type {string[]} */
  const dropped = [];
  for (const [key, v] of Object.entries(d.settings)) {
    const spec = cfg.specs.get(key);
    const c = spec?.portable ? savedValue(spec, v) : undefined;
    if (c === undefined) dropped.push(key); else settings[key] = c;
  }
  const profile = typeof d.profile === 'string' && cfg.profiles.has(d.profile) ? d.profile : null;
  return { settings, profile, dropped };
}
