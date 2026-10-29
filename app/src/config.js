// The app's settings. tools/fill.mjs writes the name, host, kit and Firebase project here; --web-config adds the web
// app's apiKey and appId (`firebase apps:sdkconfig WEB`). A public client config, not a secret: the Firestore rules
// decide who sees what. Until apiKey is set the app runs only against the local emulators (?emulator on localhost).
// accent: the default look's colour (@core/theme; boot.js), set with --accent.
export const APP = {"name":"facts","title":"Facts","host":"facts.anawj.com","accent":"#3a6390"};
export const KIT = 'https://design.anawj.com/v1/';
export const firebaseConfig = {
  "projectId": "anaesfacts-app",
  "authDomain": "facts.anawj.com",
  "apiKey": "AIzaSyCEXkVyvUg5EAgFj9Mth0zFkufyZ9tnOVI",
  "appId": "1:50399675148:web:2d86b53ec77fdbb36a7f29",
  "storageBucket": "anaesfacts-app.firebasestorage.app",
  "messagingSenderId": "50399675148"
};
