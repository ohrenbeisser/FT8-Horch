// Installation der PWA: Karte in den Einstellungen (immer da, still) und genau ein Hinweis im QSO-Reiter.
// Der Browser darf den Installationsdialog nur auf einen Tipp hin zeigen. Chrome meldet die Möglichkeit mit dem
// Ereignis beforeinstallprompt, Safari auf iOS kennt das nicht (dort steht nur die Anleitung von Hand).
import { einstellung, setzeEinstellung } from './src/settings.js';
import { t } from './src/i18n.js';
import { istInstalliert, istIos, zeigeHinweis, karteZustand } from './src/installieren.js';

const $ = (id) => document.getElementById(id);

// Das Ereignis kann kurz nach dem Laden eintreffen, deshalb wird es schon beim Einlesen des Moduls abgefangen
let angebot = null;
let neuInstalliert = false; // in dieser Sitzung installiert (das Fenster ist dann noch ein Browsertab)
let beiAenderung = () => {};
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); angebot = ev; beiAenderung(); });
window.addEventListener('appinstalled', () => { angebot = null; neuInstalliert = true; beiAenderung(); });

const laeuftInstalliert = () => istInstalliert({
  standalone: ['standalone', 'minimal-ui', 'fullscreen'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches),
  iosStandalone: navigator.standalone === true,
});

export function erzeugeInstallation({ qsoAktiv, mikLaeuft }) {
  const zustand = () => karteZustand({
    installiert: laeuftInstalliert(),
    neu: neuInstalliert,
    installierbar: !!angebot,
    ios: istIos(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
    sicher: window.isSecureContext,
  });

  function zeichneKarte() {
    const z = zustand();
    $('installText').textContent = t(`install.state.${z}`);
    $('btnInstall').hidden = z !== 'knopf';
  }

  function pruefeHinweis() {
    const ja = zeigeHinweis({
      starts: einstellung('starts'), gezeigt: einstellung('installHinweis') === 'gezeigt',
      installiert: laeuftInstalliert(), installierbar: !!angebot, mikLaeuft: mikLaeuft(), qsoAktiv: qsoAktiv(),
    });
    if (!ja) return;
    setzeEinstellung('installHinweis', 'gezeigt'); // genau einmal, egal was danach passiert
    $('installBand').hidden = false;
  }

  async function installieren() {
    if (!angebot) return;
    const a = angebot;
    angebot = null; // das Angebot gilt nur für einen Aufruf
    $('installBand').hidden = true;
    try {
      await a.prompt();
      const wahl = await a.userChoice;
      if (wahl?.outcome === 'accepted') neuInstalliert = true;
    } catch { /* der Nutzer hat abgebrochen oder der Browser wollte nicht */ }
    zeichneKarte();
  }

  beiAenderung = () => { zeichneKarte(); pruefeHinweis(); };
  $('btnInstall').addEventListener('click', installieren);
  $('btnInstallHinweis').addEventListener('click', installieren);
  $('btnInstallZu').addEventListener('click', () => { $('installBand').hidden = true; });
  zeichneKarte();
  pruefeHinweis();
  return { zeichne: zeichneKarte };
}
