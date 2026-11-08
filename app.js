// FT8-Horch: Gerüst der App (Navigation, Profil, Einstellungen, Thema, Sprache).
import { Clock } from './src/clock.js';
import { createProfile, checkProfile, KT_WERTE, KF_WERTE } from './src/profile.js';
import { einstellung, setzeEinstellung, beiAenderung } from './src/settings.js';
import { initSchublade } from './src/schublade.js';
import './src/dialogkopf.js';
import { erzeugeAudioEinstellungen } from './audio-einst.js';
import { erkenneSprache, ladeSprache, aktuelleSprache, t, uebersetzeSeite, zahl } from './src/i18n.js';
import { erzeugeQsoAnsicht, hms } from './qso-view.js';
import { pruefeZeit, holeServerDatum, offsetAusMessung } from './src/zeitpruefung.js';
import { erzeugeLogAnsicht } from './log-view.js';
import { erzeugeLaborAnsicht } from './labor-view.js';
import { erzeugeCodierungsAnsicht } from './coding-view.js';
import { erzeugeHilfeAnsicht } from './help-view.js';
import { erzeugeInstallation } from './install.js';
import { VERSION, STAND } from './src/version.js';
import { maidenhead } from './src/locator.js';
import { herunterladen } from './src/herunterladen.js';
import { erzeugeSicherung, liesSicherung, SICHERUNGS_SCHLUESSEL } from './src/sicherung.js';
import { speicherStatus, fordereDauerhaft } from './src/speicher.js';

const $ = (id) => document.getElementById(id);
const uhr = new Clock();
const profil = () => {
  try { return createProfile({ kt: einstellung('kt'), kf: einstellung('kf'), f0: einstellung('txf') || 1500 }); }
  catch { return createProfile(); }
};

// ---------------------------------------------------------------------------------------------
// Sprache und Thema
function wendeThemaAn() {
  const th = einstellung('theme');
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
}

function schreibeProfilChip() {
  const p = profil();
  $('profilChip').textContent = p.standard
    ? `${t('profile.standard')} · ${Math.round(p.f0)} Hz`
    : `${t('profile.variant')} · ${p.slotSec} s · ${zahl(p.toneSpacing)} Hz`;
}

// Snackbar
let snackZeit = 0;
function meldung(text) {
  const s = $('snackbar');
  s.textContent = text;
  s.classList.add('zeigen');
  clearTimeout(snackZeit);
  snackZeit = setTimeout(() => s.classList.remove('zeigen'), 4000);
}

// ---------------------------------------------------------------------------------------------
// Navigation
// Seiten außerhalb der vier Ziele: Hilfe, Über, Einstellungen. Jede hat ihren Eintrag in der Navigation.
const SEITEN = { hilfe: 'btnHilfe', ueber: 'btnUeber', einstellungen: 'btnEinst' };
const TITEL = { qso: 'nav.qso', codierung: 'nav.coding', labor: 'nav.lab', log: 'nav.log', hilfe: 'head.help', ueber: 'head.about', einstellungen: 'head.settings' };
let aktuellerTab = 'qso';
function setzeTitel() { $('titel').textContent = t(TITEL[aktuellerTab]); document.title = `${t('app.name')} – ${t(TITEL[aktuellerTab])}`; }

function zeigeTab(name) {
  if (SEITEN[name]) {
    const aktiv = document.querySelector('.tab.aktiv');
    const aktivName = aktiv ? aktiv.id.replace('tab-', '') : 'qso';
    if (!SEITEN[aktivName]) vorherTab = aktivName; // von einer Seite zur anderen: Rücksprung bleibt das letzte Ziel
    if (name === 'hilfe') hilfe?.zeige();
    if (name === 'ueber') fuelleUeber();
    if (name === 'einstellungen') fuelleEinstellungen();
  }
  for (const sec of document.querySelectorAll('.tab')) sec.classList.toggle('aktiv', sec.id === `tab-${name}`);
  aktuellerTab = name; setzeTitel();
  for (const b of document.querySelectorAll('#schublade .sch-eintrag')) {
    if (b.dataset.tab === name || (SEITEN[name] && b.id === SEITEN[name])) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  document.querySelector('main').scrollTop = 0;
  if (!SEITEN[name]) { try { sessionStorage.setItem('horch_tab', name); } catch { /* egal */ } }
}

// Über: Daten zur App und zum Autor
// Verwendete Komponenten von Dritten: Name, Urheber, Lizenz mit Link, Verwendung (Text in lang/ unter about.comp.<id>)
const KOMPONENTEN = [
  { id: 'wsjtx', name: 'WSJT-X', von: 'Joe Taylor (K1JT), Steve Franke (K9AN), Bill Somerville (G4WJS)', lizenz: 'GPL-3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
  { id: 'ft8lib', name: 'ft8_lib', von: 'Karlis Goba (YL3JG)', lizenz: 'MIT', url: 'https://opensource.org/license/mit' },
  { id: 'roboto', name: 'Roboto, Roboto Mono', von: 'The Roboto Project Authors', lizenz: 'SIL OFL 1.1', url: 'https://openfontlicense.org' },
  { id: 'montserrat', name: 'Montserrat Alt1', von: 'The Montserrat Project Authors', lizenz: 'SIL OFL 1.1', url: 'https://openfontlicense.org' },
  { id: 'symbols', name: 'Material Symbols', von: 'Google', lizenz: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  { id: 'mcu', name: 'Material Color Utilities', von: 'Google', lizenz: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
];
const LINK_LIZENZ = 'https://www.gnu.org/licenses/gpl-3.0.html';
const LINK_SEITE = 'https://ohrenbeisser.de';
const LINK_PROJEKT = 'https://github.com/ohrenbeisser/FT8-Horch';

function fuelleUeber() {
  const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
  const link = (text, href) => { const a = el('a', '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  // wert: Text oder fertiges Element (Link)
  const zeile = (ziel, k, wert) => {
    const d = el('div', 'messzeile');
    const w = el('span'); w.append(wert);
    d.append(el('span', '', k), w);
    ziel.append(d);
  };
  const app = $('ueberApp'), komp = $('ueberKomponenten');
  app.replaceChildren(); komp.replaceChildren();
  const stand = new Intl.DateTimeFormat(aktuelleSprache(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${STAND}T00:00:00Z`));
  zeile(app, t('about.version'), VERSION);
  zeile(app, t('about.build'), stand);
  zeile(app, t('about.license'), link('GPL-3.0-or-later', LINK_LIZENZ));
  zeile(app, t('about.authorLabel'), t('about.authorValue'));
  zeile(app, t('about.website'), link('ohrenbeisser.de', LINK_SEITE));
  zeile(app, t('about.project'), link('github.com/ohrenbeisser/FT8-Horch', LINK_PROJEKT));
  for (const k of KOMPONENTEN) {
    const d = el('div', 'komponente');
    const kopf = el('div', 'komp-kopf'); kopf.append(el('strong', '', k.name), link(k.lizenz, k.url));
    d.append(kopf, el('div', 'hint body-sm', `${k.von}. ${t(`about.comp.${k.id}`)}`));
    komp.append(d);
  }
  // Geladene Fassung der Dateien (Name des Caches im Service Worker): zeigt, ob nach einer Änderung die neue Fassung läuft
  try { window.caches?.keys().then((namen) => { const k = namen.find((n) => n.startsWith('horch-')); if (k) zeile(app, t('about.cache'), k); }).catch(() => {}); } catch { /* ohne Cache keine Anzeige */ }
}

// ---------------------------------------------------------------------------------------------
// Log und Protokoll: log-view.js. Rückfrage vor dem Löschen für alle Listen
let aktionNachJa = null;
function bestaetige(titel, text, aktion, jaText = t('log.clearYes')) {
  $('dlgLeerenTitel').textContent = titel;
  $('leerenText').textContent = text;
  $('btnLeerenJa').textContent = jaText;
  aktionNachJa = aktion;
  $('dlgLeeren').showModal();
}

let logAnsicht;
let labor;
let codierung;
let installation;
let hilfe;
let vorherTab = 'qso';

// Locator aus dem Standort (nur auf Nutzeraktion, Berechnung lokal)
function bestimmeOrt() {
  if (!navigator.geolocation) { $('einstWarn').textContent = t('settings.locateFailed'); return; }
  $('btnOrt').disabled = true;
  $('einstWarn').textContent = t('settings.locating');
  navigator.geolocation.getCurrentPosition((pos) => {
    $('btnOrt').disabled = false;
    try {
      const grid = maidenhead(pos.coords.latitude, pos.coords.longitude);
      setzeEinstellung('grid', grid);
      $('grid').value = grid;
      pruefeStation();
      if (!$('einstWarn').textContent) $('einstWarn').textContent = t('settings.located', { grid });
    } catch { $('einstWarn').textContent = t('settings.locateFailed'); }
  }, () => { $('btnOrt').disabled = false; $('einstWarn').textContent = t('settings.locateFailed'); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
}

// ---------------------------------------------------------------------------------------------
// Profil-Sheet
function segmente(ziel, werte, aktuell, beschriftung, beiWahl) {
  ziel.replaceChildren();
  for (const w of werte) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = beschriftung(w);
    b.setAttribute('aria-pressed', String(w === aktuell));
    b.addEventListener('click', () => beiWahl(w));
    ziel.append(b);
  }
}

function zeichneProfilSheet() {
  // Während eines QSO bleiben Zeit und Tonabstand stehen, die Gegenstelle würde den Wechsel nicht mitmachen
  const wechsle = (k) => (w) => { if (qso?.qsoAktiv() || labor?.testLaeuft()) { meldung(t('profile.locked')); return; } setzeEinstellung(k, w); };
  segmente($('segKt'), KT_WERTE, einstellung('kt'), (w) => `${15 * w} s`, wechsle('kt'));
  segmente($('segKf'), KF_WERTE, einstellung('kf'), (w) => `${zahl(6.25 * w)} Hz`, wechsle('kf'));
  $('txf').value = einstellung('txf');
  const p = profil();
  const pr = checkProfile(p);
  const hinweise = [...pr.errors, ...pr.warnings].map((c) => t(`profile.warn.${c}`));
  if (!p.standard) hinweise.push(t('profile.variantHint'));
  $('profilWarn').textContent = hinweise.join('; ');
}

let qso;
function profilGeaendert() {
  schreibeProfilChip();
  zeichneProfilSheet();
  $('profilHinweis').textContent = $('profilWarn').textContent;
  qso?.profilGeaendert();
  labor?.profilGeaendert();
  codierung?.profilGeaendert();
}

// ---------------------------------------------------------------------------------------------
// Einstellungen
let audioEinst = null;
function fuelleEinstellungen() {
  audioEinst?.aktualisiere();
  $('zeitquelle').value = zeitquelle();
  $('autoSkip').value = ['nie', 'heute', 'immer'].includes(einstellung('autoSkip')) ? einstellung('autoSkip') : 'heute';
  $('txHalten').value = String(einstellung('txHalten') === 1 ? 1 : 0);
  $('cqWeiter').value = String(einstellung('cqWeiter') === 1 ? 1 : 0);
  $('anrufMelden').value = String(einstellung('anrufMelden') === 0 ? 0 : 1);
  $('ausZusatzMs').value = String(einstellung('ausZusatzMs'));
  $('call').value = einstellung('call');
  $('grid').value = einstellung('grid');
  $('lang').value = einstellung('lang') || erkenneSprache('');
  $('theme').value = einstellung('theme');
  zeigeSpeicherInfo();
}

async function wechselSprache(code) {
  setzeEinstellung('lang', code);
  await ladeSprache(code);
  uebersetzeSeite();
  schreibeProfilChip();
  zeichneProfilSheet();
  logAnsicht?.uebersetzt();
  installation?.zeichne();
  fuelleUeber();
  if ($('tab-hilfe').classList.contains('aktiv')) hilfe?.zeige();
  labor?.profilGeaendert();
  labor?.uebersetzt();
  codierung?.neuZeichnen();
  setzeTitel();
  audioEinst?.aktualisiere();
  zeigeZeit();
}

function pruefeStation() {
  qso.neuBauen();
  $('einstWarn').textContent = $('warnung').textContent;
}

// ---------------------------------------------------------------------------------------------
// Daten sichern: Einstellungen, Log und Protokoll als eine Datei
async function zeigeSpeicherInfo() {
  $('speicherInfo').textContent = t(`data.persist.${await speicherStatus()}`);
}

async function speichereSicherung() {
  const d = await logAnsicht.sicherungsdaten();
  const einst = Object.fromEntries(SICHERUNGS_SCHLUESSEL.map((k) => [k, einstellung(k)]));
  const datum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  herunterladen(erzeugeSicherung({ einstellungen: einst, qsos: d.qsos, protokoll: d.protokoll, version: VERSION }), `ft8-horch-sicherung_${datum}.json`, 'application/json');
  $('datenStatus').textContent = t('data.saved', { q: d.qsos.length, p: d.protokoll.length });
}

// Übernimmt die Einstellungen einer Sicherung. Rufzeichen und Locator nur, wenn sie gefüllt sind, Zeit und Tonabstand nicht
// während eines QSO. Gibt die Zahl der übernommenen Einstellungen zurück.
async function wendeEinstellungenAn(e) {
  let n = 0;
  for (const [k, v] of Object.entries(e)) {
    if ((k === 'call' || k === 'grid') && !v) continue;
    if ((k === 'kt' || k === 'kf') && qso.qsoAktiv()) continue;
    if (einstellung(k) === v) continue;
    setzeEinstellung(k, v);
    n++;
  }
  wendeThemaAn();
  if (e.lang && e.lang !== aktuelleSprache()) await wechselSprache(e.lang);
  fuelleEinstellungen();
  if (!qso.qsoAktiv()) pruefeStation(); // ein laufendes QSO nicht abbrechen
  return n;
}

async function leseSicherungsdatei(datei) {
  const status = $('datenStatus');
  status.textContent = '';
  let r;
  try { r = liesSicherung(await datei.text()); } catch { status.textContent = t('data.err.lesen'); return; }
  if (r.fehler) { status.textContent = t(`data.err.${r.fehler}`); return; }
  bestaetige(t('data.restoreTitle'), t('data.restoreText', { q: r.qsos.length, p: r.protokoll.length, e: Object.keys(r.einstellungen).length }), async () => {
    const res = await logAnsicht.spieleSicherungEin(r);
    const e = await wendeEinstellungenAn(r.einstellungen);
    const v = r.verworfen.einstellungen + r.verworfen.qsos + r.verworfen.protokoll;
    status.textContent = t('data.restored', { q: res.qsos, dq: res.qsosDoppelt, p: res.protokoll, e, v: v ? t('data.skipped', { n: v }) : '' });
    fordereDauerhaft().then(zeigeSpeicherInfo);
  }, t('data.restoreYes'));
}

// ---------------------------------------------------------------------------------------------
// Zeitprüfung gegen den Server, von dem die App kommt
const sek = (ms) => zahl(Math.abs(ms) / 1000, 1);
const vorz = (ms) => (Math.abs(ms) < 50 ? '' : ms > 0 ? '+' : '−'); // unter 0,05 s steht die Null ohne Vorzeichen
let zeitErgebnis = null;
let serverzeitAktiv = false; // in dieser Sitzung wurde schon eine brauchbare Messung als Ausgleich übernommen

const zeitquelle = () => (einstellung('zeitquelle') === 'server' ? 'server' : 'system');

// Zeitquelle Serverzeit: Eine brauchbare Messung wird automatisch zum Ausgleich der App-Uhr. Während eines QSO ändert
// sich nichts, damit die Fenster nicht mitten im Verkehr springen.
function uebernimmServerzeit() {
  if (zeitquelle() !== 'server' || qso?.qsoAktiv()) return;
  const aus = offsetAusMessung(zeitErgebnis);
  if (aus === null) return;
  uhr.offsetMs = aus;
  serverzeitAktiv = true;
}

function zeigeServerzeit() {
  $('zeitHinweis').replaceChildren();
  $('btnZeitAus').hidden = true;
  const info = $('zeitInfo');
  let text;
  let warnen = false;
  if (serverzeitAktiv) {
    const a = zeitErgebnis ? zeitErgebnis.abweichungMs : -uhr.offsetMs;
    text = t('time.server.active', { dev: vorz(a) + sek(a), unc: sek(zeitErgebnis?.unsicherheitMs ?? 0) });
  } else if (zeitErgebnis) { text = t('time.server.unsure', { unc: sek(zeitErgebnis.unsicherheitMs) }); warnen = true; }
  else { text = t('time.server.none'); warnen = true; }
  info.textContent = text;
  if (warnen) { const d = document.createElement('div'); d.textContent = text; $('zeitHinweis').append(d); }
}

function zeigeZeit() {
  if (zeitquelle() === 'server') { zeigeServerzeit(); return; }
  const hinweis = $('zeitHinweis');
  const info = $('zeitInfo');
  const aus = $('btnZeitAus');
  aus.hidden = uhr.offsetMs === 0;
  hinweis.replaceChildren();
  if (!zeitErgebnis) { info.textContent = uhr.offsetMs ? t('time.corrected', { dev: vorz(-uhr.offsetMs) + sek(uhr.offsetMs) }) : ''; return; }
  const { abweichungMs: a, unsicherheitMs: u } = zeitErgebnis;
  const dev = vorz(a) + sek(a);
  const unc = sek(u);
  const falsch = Math.abs(a) - u > 400 && uhr.offsetMs === 0;
  if (uhr.offsetMs) info.textContent = t('time.corrected', { dev: vorz(-uhr.offsetMs) + sek(uhr.offsetMs) });
  else info.textContent = falsch ? t('time.off', { dev, unc }) : u > 400 ? t('time.unsure', { unc }) : t('time.ok', { dev, unc });
  if (falsch) {
    const text = document.createElement('div');
    text.textContent = `${t('time.off', { dev, unc })} ${t('time.offHint')}`;
    hinweis.append(text);
    if (u <= 300) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn text'; b.textContent = t('time.fix');
      b.addEventListener('click', gleicheZeitAus);
      hinweis.append(b);
    }
  }
}

// Kopfzeile: oben die Zeit, mit der die App rechnet, darunter der Unterschied der jeweils anderen Uhr (andere minus angezeigte)
function zeigeUhr() {
  $('uhrZeit').textContent = hms(uhr.now());
  const server = zeitquelle() === 'server';
  let ms = null;
  if (server) { if (serverzeitAktiv) ms = -uhr.offsetMs; } else if (zeitErgebnis) ms = -zeitErgebnis.abweichungMs - uhr.offsetMs;
  const name = t(server ? 'clock.system' : 'clock.server');
  $('uhrDiff').textContent = ms === null ? `(? ${name})` : `(${Math.abs(ms) < 50 ? '±' : ms > 0 ? '+' : '−'}${sek(ms)} s ${name})`;
}

function gleicheZeitAus() {
  uhr.offsetMs = -Math.round(zeitErgebnis.abweichungMs);
  meldung(t('time.fixed', { dev: vorz(zeitErgebnis.abweichungMs) + sek(zeitErgebnis.abweichungMs) }));
  zeigeZeit();
}

async function pruefeUhr() {
  $('btnZeit').disabled = true;
  $('zeitInfo').textContent = t('time.checking');
  try {
    zeitErgebnis = await pruefeZeit({ holeDatum: () => holeServerDatum() });
  } catch {
    zeitErgebnis = null;
    $('zeitInfo').textContent = t('time.failed');
    $('btnZeit').disabled = false;
    if (zeitquelle() === 'server') zeigeZeit();
    return;
  }
  $('btnZeit').disabled = false;
  uebernimmServerzeit();
  zeigeZeit();
}

// ---------------------------------------------------------------------------------------------
async function start() {
  const code = erkenneSprache(einstellung('lang'));
  await ladeSprache(code);
  uebersetzeSeite();
  initSchublade();
  audioEinst = erzeugeAudioEinstellungen({ t, einstellung, setzeEinstellung });
  wendeThemaAn();

  logAnsicht = erzeugeLogAnsicht({ meldung, bestaetige, meinCall: () => einstellung('call'), meinGrid: () => einstellung('grid'), profil });
  qso = erzeugeQsoAnsicht({
    uhr, profil, beiLog: (r) => logAnsicht.speichereQso(r), eintraege: () => logAnsicht.alleQsos(), beiProtokoll: (z) => logAnsicht.aufProtokoll(z), meldung,
    beiCodierung: (daten) => { codierung.zeigeEmpfang(daten); zeigeTab('codierung'); },
  });
  labor = erzeugeLaborAnsicht({ audio: qso.audio, qsoAktiv: qso.qsoAktiv, abonniere: qso.abonniere, station: qso.station, meldung, profil, jetzt: () => uhr.now(), beiCodierung: (daten) => { codierung.zeigeEmpfang(daten); zeigeTab('codierung'); } });
  codierung = erzeugeCodierungsAnsicht({
    profil, meldung, audio: qso.audio, qsoAktiv: qso.qsoAktiv,
    startText: () => (einstellung('call') && einstellung('grid') ? `CQ ${einstellung('call')} ${einstellung('grid')}` : 'CQ DL6LG JO60'),
  });
  setzeEinstellung('starts', einstellung('starts') + 1);
  installation = erzeugeInstallation({ qsoAktiv: qso.qsoAktiv, mikLaeuft: qso.mikLaeuft });
  qso.setzeSperre(() => (labor.testLaeuft() ? t('vt.locked') : null));
  window.__horch = { qso: qso.debug, uhr, logAnsicht, audio: qso.audio, codierung, labor };

  for (const b of document.querySelectorAll('#schublade .sch-eintrag[data-tab]')) b.addEventListener('click', () => zeigeTab(b.dataset.tab));
  let tab = 'qso';
  try { tab = sessionStorage.getItem('horch_tab') || 'qso'; } catch { /* egal */ }
  zeigeTab(document.getElementById(`tab-${tab}`) ? tab : 'qso');

  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    for (const b of d.querySelectorAll('[data-schliessen]')) b.addEventListener('click', () => d.close());
  }
  // Egal woher die Änderung kommt (Profil-Dialog, Tipp in den Wasserfall, Tipp auf ein CQ): Chip und Ansichten folgen
  beiAenderung((k) => { if (k === 'kt' || k === 'kf' || k === 'txf') profilGeaendert(); });
  $('profilChip').addEventListener('click', () => { zeichneProfilSheet(); $('dlgProfil').showModal(); });
  hilfe = erzeugeHilfeAnsicht();
  // Ein Tipp auf den Eintrag der offenen Seite führt zurück, sonst öffnet er die Seite
  for (const [seite, knopf] of Object.entries(SEITEN)) {
    $(knopf).addEventListener('click', () => zeigeTab($(`tab-${seite}`).classList.contains('aktiv') ? vorherTab : seite));
  }
  for (const id of ['btnHilfeZurueck', 'btnUeberZurueck', 'btnEinstZurueck']) $(id).addEventListener('click', () => zeigeTab(vorherTab));

  $('txf').addEventListener('change', () => {
    const f = Math.round(Number($('txf').value));
    if (Number.isFinite(f) && f > 0) setzeEinstellung('txf', f);
    profilGeaendert();
  });
  for (const id of ['call', 'grid']) {
    $(id).addEventListener('change', () => { setzeEinstellung(id, $(id).value.trim().toUpperCase()); $(id).value = einstellung(id); pruefeStation(); });
  }
  $('btnOrt').addEventListener('click', bestimmeOrt);
  $('btnSicherung').addEventListener('click', speichereSicherung);
  $('btnWiederherstellen').addEventListener('click', () => $('sicherungDatei').click());
  $('sicherungDatei').addEventListener('change', async () => { const d = $('sicherungDatei').files[0]; $('sicherungDatei').value = ''; if (d) await leseSicherungsdatei(d); });
  $('btnLeerenJa').addEventListener('click', async () => { $('dlgLeeren').close(); const f = aktionNachJa; aktionNachJa = null; await f?.(); });
  $('btnZeit').addEventListener('click', pruefeUhr);
  $('autoSkip').addEventListener('change', () => setzeEinstellung('autoSkip', $('autoSkip').value));
  $('ausZusatzMs').addEventListener('change', () => {
    const ms = Math.min(1000, Math.max(0, Math.round(Number($('ausZusatzMs').value) || 0)));
    $('ausZusatzMs').value = String(ms);
    setzeEinstellung('ausZusatzMs', ms);
  });
  for (const id of ['txHalten', 'cqWeiter', 'anrufMelden']) $(id).addEventListener('change', () => setzeEinstellung(id, Number($(id).value)));
  $('zeitquelle').addEventListener('change', () => {
    setzeEinstellung('zeitquelle', $('zeitquelle').value);
    if (zeitquelle() === 'system') { uhr.offsetMs = 0; serverzeitAktiv = false; zeigeZeit(); } else pruefeUhr();
  });
  setInterval(() => { if (zeitquelle() === 'server' && !qso.qsoAktiv()) pruefeUhr(); }, 10 * 60 * 1000); // Serverzeit alle zehn Minuten neu
  $('btnZeitAus').addEventListener('click', () => { uhr.offsetMs = 0; zeigeZeit(); });
  $('lang').addEventListener('change', () => wechselSprache($('lang').value));
  $('theme').addEventListener('change', () => { setzeEinstellung('theme', $('theme').value); wendeThemaAn(); });

  schreibeProfilChip();
  profilGeaendert();
  setInterval(zeigeUhr, 250);

  if (!einstellung('call')) zeigeTab('einstellungen');

  pruefeUhr();
  fordereDauerhaft(); // bei Chrome ohne Rückfrage, nach Nutzung und Installation oft gewährt

  if ('serviceWorker' in navigator) {
    // Eine neue Fassung übernimmt die Seite erst nach dem nächsten Laden. Ohne Mikrofon lädt die App von selbst neu,
    // sonst kommt ein Hinweis, damit nie mit gemischten Fassungen gearbeitet wird.
    const hatteSteuerung = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hatteSteuerung) return;
      if (qso?.mikLaeuft() || qso?.qsoAktiv()) meldung(t('update.ready')); else location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Service Worker kein Offline */ });
  }
}

start();
