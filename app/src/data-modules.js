// The data side of the optional modules, each wired in by `node tools/add.mjs <recipe>` (README, "Modules"): one import
// and one slot entry per module, written after the "add:" marks and taken out again by `add.mjs --remove`. cloud.js asks
// for a slot; an empty slot costs the app nothing.
// add: imports

// The files recipe's data side (recipes/files.json, files-data.js): the collection the file records sync in, the
// module for createApp, every item's files whenever one changes (-> stop), and the delete that takes an item's files.
/** @typedef {{ coll: string, engine: (space: string) => any,
 *   watch: (app: any, space: string, onFiles: (byItem: Map<string, any[]>) => void) => () => void,
 *   removeAll: (app: any, attached: any[]) => Promise<void> }} FilesData */

/** @type {{ files?: FilesData }} */
export const dataModules = {
  // add: slots
};
