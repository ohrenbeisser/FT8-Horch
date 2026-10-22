// ADIF-Export (Version 3.1.4). Ein Audio-QSO hat keine Funkfrequenz, deshalb stehen FREQ und BAND nur bei Einträgen, die
// aus einer ADIF-Datei übernommen wurden. Dazu der Import (parseAdif, adifZuEintrag).
// Standardprofil: MODE FT8. Jede Variante: MODE MFSK ohne Untermodus, das Profil steht im Kommentar und in
// einem eigenen Feld, damit sie niemand für ein WSJT-X-kompatibles FT8-QSO hält.

const PROGRAMM = 'FT8-Horch';
const VERSION = '0.1';

// Nur druckbares ASCII, sonst bricht die Längenangabe je nach Programm (Zeichen oder Bytes)
const ascii = (s) => String(s).normalize('NFKD').replace(/ß/g, 'ss').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');

export function adifFeld(name, wert) {
  if (wert === null || wert === undefined || wert === '') return '';
  const w = ascii(wert);
  return `<${name}:${w.length}>${w}`;
}

const datum = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const zeit = (ms) => new Date(ms).toISOString().slice(11, 19).replace(/:/g, '');

export function profilText(p) {
  return `kt=${p.kt} kf=${p.kf} f0=${Math.round(p.f0)}Hz`;
}

export function qsoZuAdif(r) {
  const p = r.profile ?? { kt: 1, kf: 1, f0: 1500 };
  const standard = p.kt === 1 && p.kf === 1;
  const kommentar = [
    r.importiert ? 'Aus ADIF importiert' : r.manuell ? 'Audio-QSO, von Hand eingetragen' : 'Audio-QSO (Lautsprecher und Mikrofon)',
    standard ? null : `FT8-Variante, nicht WSJT-X-kompatibel (${profilText(p)})`,
    r.confirmed ? null : 'unbestaetigt (kein 73 der Gegenseite)',
  ].filter(Boolean).join('; ');
  const felder = [
    adifFeld('CALL', r.dxCall),
    adifFeld('QSO_DATE', datum(r.startedAtMs ?? r.completedAtMs)),
    adifFeld('TIME_ON', zeit(r.startedAtMs ?? r.completedAtMs)),
    adifFeld('QSO_DATE_OFF', datum(r.completedAtMs)),
    adifFeld('TIME_OFF', zeit(r.completedAtMs)),
    adifFeld('MODE', standard ? 'FT8' : 'MFSK'),
    adifFeld('BAND', r.band),
    adifFeld('FREQ', r.freq),
    adifFeld('RST_SENT', r.rptSent),
    adifFeld('RST_RCVD', r.rptRcvd),
    adifFeld('GRIDSQUARE', r.dxGrid),
    adifFeld('STATION_CALLSIGN', r.myCall),
    adifFeld('MY_GRIDSQUARE', r.myGrid),
    adifFeld('APP_FT8HORCH_PROFILE', profilText(p)),
    adifFeld('COMMENT', kommentar),
    adifFeld('NOTES', r.notiz),
  ];
  return `${felder.filter(Boolean).join(' ')} <EOR>\n`;
}

export function erzeugeAdif(eintraege, { jetztMs = Date.now() } = {}) {
  const kopf = [
    'ADIF-Export der App FT8-Horch',
    adifFeld('ADIF_VER', '3.1.4'),
    adifFeld('PROGRAMID', PROGRAMM),
    adifFeld('PROGRAMVERSION', VERSION),
    adifFeld('CREATED_TIMESTAMP', `${datum(jetztMs)} ${zeit(jetztMs)}`),
    '<EOH>',
  ].join('\n');
  return `${kopf}\n\n${eintraege.map(qsoZuAdif).join('')}`;
}

// ---------------------------------------------------------------------------------------------
// Import

// ADIF-Text -> Liste von Datensätzen { FELDNAME: Wert }. Felder tragen ihre Länge in Zeichen: <CALL:6>DL1ABC.
// Alles vor <EOH> ist Kopf, ein Datensatz endet mit <EOR>. Unbekannte Felder bleiben erhalten.
export function parseAdif(text) {
  let s = String(text);
  const kopf = /<eoh>/i.exec(s);
  if (kopf) s = s.slice(kopf.index + kopf[0].length);
  const saetze = [];
  let satz = {};
  const feld = /<([A-Za-z0-9_]+)(?::(\d+))?(?::[A-Za-z])?>/g;
  let m;
  while ((m = feld.exec(s))) {
    const name = m[1].toUpperCase();
    if (name === 'EOR') { if (Object.keys(satz).length) saetze.push(satz); satz = {}; continue; }
    if (m[2] === undefined) continue;
    const laenge = Number(m[2]);
    satz[name] = s.slice(feld.lastIndex, feld.lastIndex + laenge);
    feld.lastIndex += laenge;
  }
  if (Object.keys(satz).length) saetze.push(satz);
  return saetze;
}

import { istRufzeichen } from './qso.js';

const RUF = { test: istRufzeichen };
const LOC = /^[A-R]{2}\d{2}([A-X]{2})?$/;

function zeitpunkt(datum, uhr) {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(datum ?? '');
  const z = /^(\d{2})(\d{2})(\d{2})?$/.exec(uhr || '0000');
  if (!d || !z) return null;
  const [j, mo, t, h, mi, se] = [d[1], d[2], d[3], z[1], z[2], z[3] ?? '0'].map(Number);
  if (h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(j, mo - 1, t, h, mi, se);
  const probe = new Date(ms);
  return probe.getUTCFullYear() === j && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === t ? ms : null;
}

// Eigenes Profilfeld aus dem Export: "kt=2 kf=1 f0=1500Hz"
function profilAusFeld(text) {
  const m = /kt=(\d+)\s+kf=(\d+)\s+f0=(\d+)/.exec(text ?? '');
  return m ? { kt: Number(m[1]), kf: Number(m[2]), f0: Number(m[3]) } : null;
}

// Datensatz -> Eintrag für das Log. Rückgabe { grund, eintrag }; grund ist null oder 'betriebsart' (kein FT8, nicht übernommen)
// oder 'ungueltig' (Rufzeichen oder Zeit fehlt).
export function adifZuEintrag(f) {
  const mode = String(f.MODE ?? '').toUpperCase();
  const eigen = profilAusFeld(f.APP_FT8HORCH_PROFILE);
  if (mode !== 'FT8' && !(mode === 'MFSK' && eigen)) return { grund: 'betriebsart', eintrag: null };
  const dxCall = String(f.CALL ?? '').trim().toUpperCase();
  const start = zeitpunkt(f.QSO_DATE, f.TIME_ON);
  if (!RUF.test(dxCall) || start === null) return { grund: 'ungueltig', eintrag: null };
  let ende = zeitpunkt(f.QSO_DATE_OFF ?? f.QSO_DATE, f.TIME_OFF ?? f.TIME_ON);
  if (ende === null || ende < start) ende = start;
  const rapport = (x) => (/^[+-]\d{2}$/.test(String(x ?? '').trim()) ? String(x).trim() : null);
  const grid = String(f.GRIDSQUARE ?? '').trim().toUpperCase();
  const meinGrid = String(f.MY_GRIDSQUARE ?? '').trim().toUpperCase();
  const meinCall = String(f.STATION_CALLSIGN ?? f.OPERATOR ?? '').trim().toUpperCase();
  const eintrag = {
    myCall: RUF.test(meinCall) ? meinCall : null,
    myGrid: LOC.test(meinGrid) ? meinGrid : null,
    dxCall,
    dxGrid: LOC.test(grid) ? grid : null,
    rptSent: rapport(f.RST_SENT),
    rptRcvd: rapport(f.RST_RCVD),
    confirmed: true, // ein im Logbuch eingetragenes QSO gilt als abgeschlossen
    wasCq: false,
    startedAtMs: start,
    completedAtMs: ende,
    profile: eigen ?? { kt: 1, kf: 1, f0: 1500 },
    notiz: String(f.NOTES ?? '').trim().slice(0, 200) || null,
    importiert: true,
  };
  if (/^\d{1,4}(?:c|m|mm|cm)$/i.test(String(f.BAND ?? '').trim())) eintrag.band = String(f.BAND).trim().toLowerCase();
  if (/^\d{1,6}(?:\.\d{1,6})?$/.test(String(f.FREQ ?? '').trim())) eintrag.freq = String(f.FREQ).trim();
  return { grund: null, eintrag };
}
