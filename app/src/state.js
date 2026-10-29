// The page's shared bits: the refused-save line and the shapes the screens use (the app's phase and who is signed in).
/** what the page says when the server refused a save at once (its copy waits in the refused list) */
export const REFUSED = 'The server refused that. A copy is kept in the refused list.';

/** @typedef {{ uid: string, email: string, name: string }} User */
/** @typedef {'not-set-up' | 'signed-out' | 'no-access' | 'ready'} Phase */
/** @typedef {{ phase: Phase, user?: User, role?: string }} State */
