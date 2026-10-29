// @core/settings (incubating here; it moves into app-sync once a second kind of app uses it): the options an app
// allows, kept on the device or the account, with profiles and a settings file. Named exports only and nothing runs on
// import, so a build keeps only what a page uses.
//   settings(options)   the module for createApp (module.js: the api and what sign-out and a switch do)
//   readFile / writeFile  the settings file on its own (file.js, pure), KIND and VERSION
//   compile             the option check on its own (schema.js, pure)
export { settings } from './module.js';
export { readFile, writeFile, KIND, VERSION } from './file.js';
export { compile, valueOf, isCustom } from './schema.js';
