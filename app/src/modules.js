// The optional modules this app has, each wired in by `node tools/add.mjs <recipe>` (README, "Modules"): one import
// and one slot entry per module, written after the "add:" marks and taken out again by `add.mjs --remove`. A screen
// asks its slot here; an empty slot costs the page nothing.
// add: imports

/** @type {{ listFilter?: import('./screens/list.js').ListFilter, itemFiles?: import('./screens/list.js').ItemFilesSlot }} */
export const modules = {
  // add: slots
};
