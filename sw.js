// Service Worker: legt die App beim ersten Aufruf vollständig in den Cache (Offline-Betrieb).
// Bei jeder Änderung an den Dateien VERSION erhöhen, sonst bleibt die alte Fassung stehen.
const VERSION = 'horch-98';
const DATEIEN = [
  './', 'index.html', 'app.js', 'install.js', 'qso-view.js', 'audio-einst.js', 'log-view.js', 'labor-view.js', 'coding-view.js', 'help-view.js', 'help/hilfe.de.md', 'help/hilfe.en.md',
  ...['codierung-empfangen', 'codierung-senden', 'daten-sichern', 'einstellungen', 'einstellungen-automatik', 'bedienleiste', 'qso-dunkel', 'qso-breit', 'fehlerschutz', 'laufzeit', 'log-bearbeiten', 'log-protokoll', 'log-qsos', 'navigation', 'pegeltest', 'profil', 'qso-listen', 'qso-reiter', 'simulator-einzel', 'simulator-reihe', 'ueber', 'uhr-pruefen', 'verbindungstest', 'wasserfall', 'wav-dateien'].flatMap((n) => [`help/bilder/${n}.png`, `help/bilder/en/${n}.png`]),
  'theme.css', 'basis.css', 'farben.css', 'src/schublade.js', 'src/audiogeraete.js', 'src/dialogkopf.js', 'manifest.webmanifest',
  'lang/de.json', 'lang/en.json', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'fonts/roboto-latin-400-normal.woff2', 'fonts/roboto-latin-ext-400-normal.woff2',
  'fonts/roboto-latin-500-normal.woff2', 'fonts/roboto-latin-ext-500-normal.woff2', 'fonts/roboto-latin-700-normal.woff2',
  'fonts/MontserratAlt1-Medium.woff2', 'fonts/roboto-mono-latin-400-normal.woff2', 'fonts/roboto-mono-latin-500-normal.woff2',
  ...[
    'adif', 'autoantwort', 'audio-in', 'audio-out', 'bits', 'capture-core', 'capture-worklet', 'clock', 'constants', 'crc14', 'decoder-client',
    'decoder', 'decoder-worker', 'demod', 'empfang', 'encoder', 'fft', 'gfsk', 'herunterladen', 'i18n', 'installieren', 'kette', 'laufzeit', 'ldpc', 'markdown', 'locator', 'log', 'logfilter', 'pack77', 'pegel', 'protokoll', 'profile', 'qso', 'qsofinder', 'qsomanuell', 'recorder', 'startschaetzer',
    'rauschen', 'resample', 'settings', 'sicherung', 'simulator', 'simulator-client', 'simulator-worker', 'version', 'vorschau', 'spectrum', 'speicher', 'station', 'symbols', 'sync', 'wakelock', 'waterfall', 'verbindungstest', 'wav', 'wavdatei', 'zeitpruefung',
  ].map((n) => `src/${n}.js`),
];

// Beim Installieren holt jede Datei frisch vom Server und nicht aus dem HTTP-Cache des Browsers (cache: 'reload'). Sonst könnte eine neue
// Fassung alte Dateien in den neuen Cache übernehmen, wenn der Server lange Ablaufzeiten schickt.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache zuerst, sonst Netz. Nur gleiche Herkunft.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.searchParams.has('zeit')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
