// Security headers for every answer the Worker gives (sites.js). Pure functions, tested in worker/test/headers.test.mjs.
//
// The Content-Security-Policy starts as Report-Only (docs/decisions/0003-csp-report-only-first.md): the browser reports
// what it would have blocked but blocks nothing, to /api/csp (worker/csp-report.js, one line each in the Worker log).
// Set CSP_ENFORCE to true once a live sign-in, sync and update show no reports there (the e2e tests fail on any
// report already).

// The design kit's origin. tools/fill.mjs sets it from --kit (homedesign or nuhs).
export const KIT = 'https://design.anawj.com';
export const CSP_ENFORCE = false;

// The page's import map (app/index.html), the one inline script, allowed by its hash (worker/test/headers.test.mjs
// says the new one when the map changes).
export const IMPORT_MAP = "'sha256-uYRfnB5lWG2veNj0UBS3g3j+bG36zTzM4jbc0XVTFJY='";
// Shared modules (app-sync, app-update, app-ui: its scripts and style sheets) are served at exact versions from here.
const CORE = 'https://core.anawj.com';
// Firebase: the SDK is vendored (app/public/vendor/firebase/<ver>/, served as 'self'); Google sign-in, Firestore and
// Auth APIs.
const GOOGLE_API = 'https://apis.google.com';
const FONTS_CSS = 'https://fonts.googleapis.com';
const FONTS = 'https://fonts.gstatic.com';
// where the browser sends what the policy blocked (or would have)
const REPORTS = '/api/csp';

// local: the page is served from localhost (tests), which talks to the Firebase emulators over http.
// framedBySelf: the sign-in helper pages, which the app's own page frames from this same address
export function csp({ kit = KIT, project = '', local = false, framedBySelf = false } = {}) {
  const emulators = local ? ['http://127.0.0.1:*', 'http://localhost:*', 'ws://127.0.0.1:*'] : [];
  const frames = ["'self'", 'https://accounts.google.com', ...(project ? [`https://${project}.firebaseapp.com`] : []), ...emulators.filter(e => e.startsWith('http:'))];   // (WebKit frames the auth emulator)
  const d = {
    'default-src': ["'self'"],
    'script-src': ["'self'", IMPORT_MAP, CORE, GOOGLE_API, kit],
    'style-src': ["'self'", CORE, kit, FONTS_CSS],
    'font-src': ["'self'", kit, FONTS],
    'img-src': ["'self'", 'data:', 'blob:', kit, 'https://lh3.googleusercontent.com', 'https://www.google.com'],   // (the SDK's connectivity ping)
    'connect-src': ["'self'", CORE, kit, FONTS_CSS, FONTS, 'https://*.googleapis.com', GOOGLE_API, ...emulators],
    'frame-src': frames,
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': [framedBySelf ? "'self'" : "'none'"],
    'report-uri': [REPORTS],
    'report-to': ['csp'],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

// -> [name, value] pairs to set on an answer
// helper: Firebase's sign-in helper pages (/__/auth/, /__/firebase/), passed on from firebaseapp.com. They are
// Firebase's code, with their own inline script, and Firebase sends no policy for them: the app's policy would block
// that script once enforced, so they get only the framing rule (and no opener policy).
export function securityHeaders({ kit = KIT, project = '', local = false, enforce = CSP_ENFORCE, framedBySelf = false, helper = false } = {}) {
  return [
    ...(helper ? [['Content-Security-Policy', `frame-ancestors ${framedBySelf ? "'self'" : "'none'"}`]]
      : [[enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', csp({ kit, project, local, framedBySelf })],
        ['Reporting-Endpoints', `csp="${REPORTS}"`]]),
    ...(local ? [] : [['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']]),
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', framedBySelf ? 'SAMEORIGIN' : 'DENY'],   // (authDomain is this host, so Firebase's auth iframe is framed by us)
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
    // the Google sign-in popup must be able to hand back to this page; the helper pages (Firebase's, which send none) must
    // keep window.opener across accounts.google.com, so they get no opener policy
    ...(helper ? [] : [['Cross-Origin-Opener-Policy', 'same-origin-allow-popups']]),
  ];
}
