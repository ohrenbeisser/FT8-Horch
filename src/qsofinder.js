// QSOs im Textprotokoll finden: Zeilen nach Gegenstelle gruppieren und Rufzeichen, Locator, Rapporte,
// Bestätigung und Zeiten daraus ableiten. Reine Logik, die Oberfläche steht in log-view.js.
import { parseMessage } from './qso.js';

const LUECKE_MS = 5 * 60_000;
const NAHE_MS = 10 * 60_000;

// zeilen: Protokollzeilen { typ: 'rx'|'tx', ms, text }. Rückgabe: neueste zuerst
export function findeQsos(zeilen, meinCall, { luecke = LUECKE_MS } = {}) {
  const ich = String(meinCall ?? '').trim().toUpperCase();
  if (!ich) return [];
  const je = new Map(); // Gegenstelle -> Zeilen
  for (const z of [...zeilen].sort((a, b) => a.ms - b.ms)) {
    const m = parseMessage(z.text ?? '');
    let partner = null;
    if (z.typ === 'rx' && m.kind === 'to' && m.to === ich) partner = m.de;
    else if (z.typ === 'rx' && m.kind === 'cq' && m.de !== ich) partner = m.de;
    else if (z.typ === 'tx' && m.kind === 'to' && m.de === ich) partner = m.to;
    if (!partner) continue;
    if (!je.has(partner)) je.set(partner, []);
    je.get(partner).push({ ...z, m, cq: m.kind === 'cq' });
  }
  const ergebnis = [];
  for (const [dxCall, liste] of je) {
    const gruppen = [];
    for (const z of liste) {
      const letzte = gruppen.at(-1);
      if (letzte && z.ms - letzte.at(-1).ms <= luecke) letzte.push(z);
      else gruppen.push([z]);
    }
    for (const g of gruppen) {
      const mein = g.filter((z) => z.typ === 'tx');
      const sein = g.filter((z) => z.typ === 'rx' && !z.cq);
      if (!mein.length || !sein.length) continue;
      const q = { dxCall, dxGrid: null, rptSent: null, rptRcvd: null, confirmed: false };
      for (const z of g) {
        const { m } = z;
        if (z.cq) { q.dxGrid ??= m.grid; continue; }
        if (z.typ === 'rx') {
          if (m.type === 'grid') q.dxGrid ??= m.extra;
          else if (m.type === 'report' || m.type === 'rreport') q.rptRcvd = m.extra.replace(/^R/, '');
          else if (m.type === 'rr73' || m.type === 'rrr' || m.type === '73') q.confirmed = true;
        } else if (m.type === 'report' || m.type === 'rreport') q.rptSent = m.extra.replace(/^R/, '');
      }
      const echte = g.filter((z) => !z.cq);
      q.startMs = echte[0].ms;
      q.endeMs = echte.at(-1).ms;
      ergebnis.push(q);
    }
  }
  return ergebnis.sort((a, b) => b.startMs - a.startMs);
}

// Gibt es zu dem Kandidaten schon einen Log-Eintrag (gleiche Gegenstelle, Zeiten nahe beieinander)?
export function schonImLog(kandidat, eintraege) {
  return eintraege.some((e) => {
    if (String(e.dxCall).toUpperCase() !== kandidat.dxCall) return false;
    const ende = e.completedAtMs ?? e.startedAtMs;
    const start = e.startedAtMs ?? ende;
    if (ende == null) return false;
    return kandidat.startMs <= ende + NAHE_MS && kandidat.endeMs >= start - NAHE_MS;
  });
}
