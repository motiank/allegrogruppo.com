// Joya HQ service worker — only so the browser offers "Install app". It has no fetch handler and keeps nothing: every
// request goes to the server as usual (no cache), so the app never shows old data. Without a network the browser shows its own page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
