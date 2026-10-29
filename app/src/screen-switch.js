// The screen switch: one screen per phase of the app (state.js State); showing one hides the others. A change of
// phase is drawn as a view transition (@core/theme viewSwitch); an update within the same screen is not.
import { viewSwitch } from '@core/theme';

/**
 * @param {Record<import('./state.js').Phase, import('./dom.js').Screen>} screens
 * @returns {(s: import('./state.js').State) => void} show the screen for s.phase
 */
export function screenSwitch(screens) {
  /** @type {string | null} */
  let shown = null;
  /** @type {import('./state.js').State} */
  let latest;
  // (draws the latest state: a transition runs its change a moment later, after any state that came in meanwhile)
  const draw = () => {
    for (const [phase, screen] of Object.entries(screens)) if (phase !== latest.phase) screen.hide();
    screens[latest.phase].show(latest);
  };
  return s => {
    latest = s;
    const swap = shown !== null && shown !== s.phase;
    shown = s.phase;
    if (swap) viewSwitch(draw); else draw();
  };
}
