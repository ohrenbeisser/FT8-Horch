// Installation der PWA: reine Entscheidungen (ohne Browser), damit sie sich testen lassen. Das Verdrahten mit dem
// Browser (Ereignis beforeinstallprompt, Karte in den Einstellungen, Hinweis) steht in install.js.

export const MIN_STARTS = 3; // Der Hinweis erscheint frühestens beim dritten Start

// Läuft die App schon im eigenen Fenster? (standalone: Chrome und andere, iosStandalone: Safari auf iOS)
export const istInstalliert = ({ standalone = false, iosStandalone = false } = {}) => !!(standalone || iosStandalone);

// iPhone, iPad, iPod und ein iPad, das sich als Mac ausgibt (dann hat es Touchpunkte)
export function istIos(userAgent = '', touchPunkte = 0, plattform = '') {
  return /iPhone|iPad|iPod/.test(userAgent) || (plattform === 'MacIntel' && touchPunkte > 1);
}

// Der Hinweis kommt genau einmal: nach dem dritten Start, nur wenn der Browser die Installation anbietet,
// die App nicht schon installiert ist und gerade weder Mikrofon noch QSO laufen.
export function zeigeHinweis({ starts, gezeigt, installiert, installierbar, mikLaeuft, qsoAktiv }) {
  return starts >= MIN_STARTS && !gezeigt && !installiert && installierbar && !mikLaeuft && !qsoAktiv;
}

// installiert | neu (gerade in dieser Sitzung installiert) | knopf (Browser bietet die Installation an) |
// ios (von Hand über Teilen) | menue (Browsermenü) | unsicher
export function karteZustand({ installiert, neu = false, installierbar, ios, sicher }) {
  if (installiert) return 'installiert';
  if (neu) return 'neu';
  if (installierbar) return 'knopf';
  if (ios) return 'ios';
  return sicher ? 'menue' : 'unsicher';
}
