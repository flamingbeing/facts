// The options this app allows (@core/settings): a name here is the only way a value reaches the device or the account.
// New options are off. No row on the Settings page yet: the theme and look are the kit's own (src/shell.js, "This device").
export const SETTINGS_COLL = 'settings';

/** @type {Record<string, import('app-ui/settings/types').OptionSpec>} */
export const OPTIONS = {
  // @core/settings refuses to start with no option at all, and the Align screen has none to offer yet: this one is kept
  // for the next real device option to replace (nothing reads or shows it)
  reserved: { scope: 'device', default: false },
};
