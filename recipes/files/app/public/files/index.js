// @core/files (incubating here; it moves into app-sync once a second kind of app uses it): photos and files for an
// app, offline first. Named exports only and nothing runs on import, so a build keeps only what a page uses.
//   files(options)  the module for createApp (module.js: the api, the formats, sign-out and switch)
//   prepareImage    the resize + thumbnail on its own (image.js), fit (its size rule)
// The Worker side is worker/files.js (/api/files/, an R2 bucket bound as FILES).
export { files } from './module.js';
export { prepareImage, fit } from './image.js';

/** @typedef {import('./types').FileRecord} FileRecord */
/** @typedef {import('./types').FilesApi} FilesApi */
/** @typedef {import('./types').FilesOptions} FilesOptions */
/** @typedef {import('./types').Job} Job */
