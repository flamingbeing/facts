// The options this app allows (@core/settings): a name here is the only way a value reaches the device or the account.
// New options are off. A new app replaces these with its own.
export const SETTINGS_COLL = 'settings';

/** how the list can be sorted (the Settings choice and list.js): by text, newest change first, newest item first */
export const SORTS = /** @type {[string, string][]} */ ([['text', 'By text'], ['modified', 'Last changed first'], ['created', 'Newest first']]);

/** @type {Record<string, import('app-ui/settings/types').OptionSpec>} */
export const OPTIONS = {
  // this device only: a phone and a computer can differ
  bigRows: { scope: 'device', default: false },
  sort: { scope: 'device', default: 'text', clean: v => (SORTS.some(([k]) => k === v) ? v : 'text') },
  // the person's account: every device they sign in on
  itemCount: { scope: 'account', default: false },
};

/** The Settings page's rows (src/shell.js: @core/ui settingsScreen); a row is a switch for a yes/no option. */
export const SETTING_SECTIONS = [
  { title: 'List', rows: [
    { key: 'bigRows', label: 'Larger list rows', sub: 'This device' },
    { key: 'sort', label: 'Sort the list', sub: 'This device', choices: SORTS },
    { key: 'itemCount', label: 'Show how many items there are', sub: 'Every device; sign in to change it' },
  ] },
];
