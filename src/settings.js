// Einstellungen im Browser (localStorage, der Browser darf den Zugriff verweigern). E7 baut darauf auf.
const VORGABEN = { call: '', grid: '', lang: '', theme: 'auto', kt: 1, kf: 1, txf: 1500, starts: 0, installHinweis: '', zeitquelle: 'server', autoSkip: 'heute', txHalten: 0, cqWeiter: 0, vtRolle: 'A', vtRunden: 4 };
const PRAEFIX = 'horch_';
const hoerer = new Set();
const werte = { ...VORGABEN };

function lies(k) { try { return localStorage.getItem(PRAEFIX + k); } catch { return null; } }
function schreibe(k, v) { try { localStorage.setItem(PRAEFIX + k, String(v)); } catch { /* egal */ } }

for (const k of Object.keys(VORGABEN)) {
  const roh = lies(k);
  if (roh === null) continue;
  werte[k] = typeof VORGABEN[k] === 'number' ? Number(roh) || VORGABEN[k] : roh;
}

export const einstellung = (k) => werte[k];

export function setzeEinstellung(k, v) {
  if (!(k in VORGABEN)) throw new Error(`unbekannte Einstellung ${k}`);
  if (werte[k] === v) return;
  werte[k] = v;
  schreibe(k, v);
  for (const h of hoerer) h(k, v);
}

export const beiAenderung = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };
