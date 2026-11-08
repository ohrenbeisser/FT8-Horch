// Sicherung und Wiederherstellung: Einstellungen, Log und Protokoll als eine JSON-Datei. Beim Einlesen wird jedes Feld
// geprüft, Unbrauchbares wird gezählt und verworfen. Vorhandene Daten werden nie überschrieben, nur ergänzt.
import { KT_WERTE, KF_WERTE } from './profile.js';
import { istRufzeichen } from './qso.js';

export const FORMAT = 'ft8-horch-sicherung';
export const SICHERUNG_VERSION = 1;
export const MAX_PROTOKOLL_ZEILEN = 5000;

const RUF = { test: istRufzeichen }; // Buchstaben und Ziffern, nicht nur ein Wort
const LOC = /^[A-R]{2}\d{2}([A-X]{2})?$/;
const RAPPORT = /^[+-]\d{2}$/;
const BAND = /^\d{1,4}(?:c|m|mm|cm)$/i;
const FREQ = /^\d{1,6}(?:\.\d{1,6})?$/;
const DUBLETTE_MS = 120_000; // gleiche Gegenstelle, Beginn höchstens so weit auseinander: gilt als dasselbe QSO

const zahl = (x) => typeof x === 'number' && Number.isFinite(x);
const textOderNull = (x, max = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);

// Einstellungen, die gesichert werden (nicht: Startzähler und Installationshinweis)
const PRUEFER = {
  call: (v) => typeof v === 'string' && (v === '' || RUF.test(v.toUpperCase())) && v.toUpperCase(),
  grid: (v) => typeof v === 'string' && (v === '' || /^[A-R]{2}\d{2}$/.test(v.toUpperCase())) && v.toUpperCase(),
  lang: (v) => ['', 'de', 'en'].includes(v) && v,
  theme: (v) => ['auto', 'light', 'dark'].includes(v) && v,
  kt: (v) => KT_WERTE.includes(v) && v,
  kf: (v) => KF_WERTE.includes(v) && v,
  txf: (v) => zahl(v) && v >= 200 && v <= 3000 && Math.round(v),
  zeitquelle: (v) => ['system', 'server'].includes(v) && v,
  autoSkip: (v) => ['nie', 'heute', 'immer'].includes(v) && v,
  txHalten: (v) => (v === 0 || v === 1) && v,
  cqWeiter: (v) => (v === 0 || v === 1) && v,
  anrufMelden: (v) => (v === 0 || v === 1) && v,
  ausZusatzMs: (v) => zahl(v) && v >= 0 && v <= 1000 && Math.round(v),
};
export const SICHERUNGS_SCHLUESSEL = Object.keys(PRUEFER);

// Eintrag des Logs prüfen und bereinigen (ohne id). null, wenn er nicht brauchbar ist.
export function bereinigeQso(r) {
  if (!r || typeof r !== 'object') return null;
  const dxCall = typeof r.dxCall === 'string' ? r.dxCall.trim().toUpperCase() : '';
  if (!RUF.test(dxCall)) return null;
  const ende = zahl(r.completedAtMs) ? r.completedAtMs : r.startedAtMs;
  if (!zahl(ende)) return null;
  const start = zahl(r.startedAtMs) ? r.startedAtMs : ende;
  const p = r.profile ?? {};
  const profile = { kt: KT_WERTE.includes(p.kt) ? p.kt : 1, kf: KF_WERTE.includes(p.kf) ? p.kf : 1, f0: zahl(p.f0) ? p.f0 : 1500 };
  const raum = (x) => (typeof x === 'string' && RAPPORT.test(x.trim()) ? x.trim() : null);
  const grid = typeof r.dxGrid === 'string' ? r.dxGrid.trim().toUpperCase() : '';
  const meinCall = typeof r.myCall === 'string' ? r.myCall.trim().toUpperCase() : '';
  const meinGrid = typeof r.myGrid === 'string' ? r.myGrid.trim().toUpperCase() : '';
  const aus = {
    myCall: RUF.test(meinCall) ? meinCall : null,
    myGrid: LOC.test(meinGrid) ? meinGrid : null,
    dxCall,
    dxGrid: LOC.test(grid) ? grid : null,
    rptSent: raum(r.rptSent),
    rptRcvd: raum(r.rptRcvd),
    confirmed: !!r.confirmed,
    wasCq: !!r.wasCq,
    startedAtMs: start,
    completedAtMs: ende,
    profile,
    notiz: textOderNull(r.notiz),
  };
  if (r.manuell) aus.manuell = true;
  if (r.importiert) aus.importiert = true;
  if (typeof r.band === 'string' && BAND.test(r.band.trim())) aus.band = r.band.trim().toLowerCase();
  if (typeof r.freq === 'string' && FREQ.test(r.freq.trim())) aus.freq = r.freq.trim();
  return aus;
}

// Zeile des Protokolls prüfen und bereinigen (ohne id)
export function bereinigeProtokollzeile(z) {
  if (!z || typeof z !== 'object' || !zahl(z.ms) || typeof z.text !== 'string' || !z.text.trim()) return null;
  if (z.typ !== 'rx' && z.typ !== 'tx') return null;
  const parity = z.parity === 'odd' ? 'odd' : 'even';
  if (!zahl(z.f0)) return null;
  const aus = { typ: z.typ, ms: z.ms, parity, f0: z.f0, text: z.text.trim().slice(0, 200) };
  if (z.typ === 'rx') {
    if (!zahl(z.snr) || !zahl(z.dt)) return null;
    aus.snr = z.snr;
    aus.dt = z.dt;
  } else if (zahl(z.n)) aus.n = z.n;
  return aus;
}

export function erzeugeSicherung({ einstellungen, qsos, protokoll, jetztMs = Date.now(), version = '' }) {
  const e = {};
  for (const k of SICHERUNGS_SCHLUESSEL) if (k in einstellungen) e[k] = einstellungen[k];
  const ohneId = ({ id, ...rest }) => rest; // eslint-disable-line no-unused-vars
  return JSON.stringify({
    format: FORMAT,
    version: SICHERUNG_VERSION,
    app: version,
    erstellt: new Date(jetztMs).toISOString(),
    einstellungen: e,
    log: qsos.map(ohneId),
    protokoll: protokoll.map(ohneId),
  });
}

// Text einer Sicherungsdatei -> { fehler: Code oder null, einstellungen, qsos, protokoll, verworfen: { einstellungen, qsos, protokoll } }
export function liesSicherung(text) {
  let d;
  try { d = JSON.parse(text); } catch { return { fehler: 'kein_json' }; }
  if (!d || d.format !== FORMAT) return { fehler: 'falsches_format' };
  if (!Number.isInteger(d.version) || d.version > SICHERUNG_VERSION) return { fehler: 'neuere_version' };
  const verworfen = { einstellungen: 0, qsos: 0, protokoll: 0 };
  const einstellungen = {};
  for (const [k, v] of Object.entries(d.einstellungen && typeof d.einstellungen === 'object' ? d.einstellungen : {})) {
    const p = PRUEFER[k];
    const w = p ? p(v) : false;
    if (w === false) verworfen.einstellungen++;
    else einstellungen[k] = w;
  }
  const qsos = [];
  for (const r of Array.isArray(d.log) ? d.log : []) { const b = bereinigeQso(r); if (b) qsos.push(b); else verworfen.qsos++; }
  const protokoll = [];
  for (const z of Array.isArray(d.protokoll) ? d.protokoll : []) { const b = bereinigeProtokollzeile(z); if (b) protokoll.push(b); else verworfen.protokoll++; }
  return { fehler: null, einstellungen, qsos, protokoll: protokoll.slice(-MAX_PROTOKOLL_ZEILEN), verworfen };
}

export function gleichesQso(a, b) {
  return a.dxCall === b.dxCall && Math.abs((a.startedAtMs ?? a.completedAtMs) - (b.startedAtMs ?? b.completedAtMs)) <= DUBLETTE_MS;
}

// Aus kandidaten die Einträge, die im Log noch fehlen. Auch untereinander werden Dubletten ausgelassen.
export function neueQsos(vorhanden, kandidaten) {
  const neu = [];
  let dubletten = 0;
  for (const k of kandidaten) {
    if (vorhanden.some((v) => gleichesQso(v, k)) || neu.some((v) => gleichesQso(v, k))) dubletten++;
    else neu.push(k);
  }
  return { neu, dubletten };
}

export function neueProtokollzeilen(vorhanden, kandidaten) {
  const schluessel = (z) => `${z.typ}|${z.ms}|${z.text}`;
  const bekannt = new Set(vorhanden.map(schluessel));
  const neu = [];
  for (const k of kandidaten) {
    const s = schluessel(k);
    if (bekannt.has(s)) continue;
    bekannt.add(s);
    neu.push(k);
  }
  return { neu, dubletten: kandidaten.length - neu.length };
}
