// Motion for @core/theme: a change of screen drawn as a view transition (the browser cross-fades a snapshot of the
// old screen into the new one) where the browser has them and the device allows motion; otherwise the change just
// happens. The springs and their length are custom properties (theme.css), shortened when motion is reduced.

/** @returns {boolean}  Still on this device, or the device asks for less motion (or can't say: no matchMedia) */
const still = () => (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'still')
  || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs `change` (a DOM update) inside a view transition when it can, else straight away.
 * @param {() => void} change
 */
export function viewSwitch(change) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function' || still()) change();
  else document.startViewTransition(change);
}
