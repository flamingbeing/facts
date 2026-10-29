// The app's settings. tools/fill.mjs writes the name, title, host and kit here. A static app has no Firebase project:
// its data stays on the device (local.js); `node tools/add.mjs cloud --project <id>` adds one.
// accent: the default look's colour (@core/theme; boot.js), set with --accent.
export const APP = {"name":"starter-app","title":"Starter app","host":"app.example.com","accent":"#3a6390"};
export const KIT = 'https://design.flamingbeing.com/v1/';
