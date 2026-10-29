// Runs first, before anything else on the page. Installable, never prompted: the browser's own install banner is
// cancelled (the manifest, icons and service worker stay, so "Add to Home Screen" from the menu still works). Then this
// device's theme, before the first paint, so a chosen look never flashes the default one.
import { applyTheme } from '@core/theme';
import { APP } from './config.js';

addEventListener('beforeinstallprompt', e => e.preventDefault());
applyTheme({ accent: APP.accent });
