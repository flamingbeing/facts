// The app's settings. tools/fill.mjs writes the name, host, kit and Firebase project here; --web-config adds the web
// app's apiKey and appId (`firebase apps:sdkconfig WEB`). A public client config, not a secret: the Firestore rules
// decide who sees what. Until apiKey is set the app runs only against the local emulators (?emulator on localhost).
// accent: the default look's colour (@core/theme; boot.js), set with --accent.
export const APP = {"name":"starter-app","title":"Starter app","host":"app.example.com","accent":"#3a6390"};
export const KIT = 'https://design.flamingbeing.com/v1/';
export const firebaseConfig = {
  "projectId": "demo-starter-app",
  "authDomain": "app.example.com",
  "apiKey": "",
  "appId": ""
};
