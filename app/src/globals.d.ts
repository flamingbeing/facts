// Types the checker can't find on its own (tsconfig.json). Firebase and the update register script load by URL
// (index.html's import map), so they are typed loosely here; app-sync's own types come from its .d.ts.
declare module 'firebase/app';
declare module 'firebase/auth';
declare module 'firebase/firestore';
declare module 'app-update/register.js';

interface Window {
  /** What the tests read: set by app.js. */
  starter: {
    ready: boolean;
    /** ?emulator only: sign in as a made-up Google account (cloud.js emulatorSignIn; works in a Vite build too). */
    signInAs?: (email: string) => Promise<unknown>;
    status?: string;
    [key: string]: unknown;
  };
}
