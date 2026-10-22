// Zwischenwerte der Decodierung für den Codierungs-Tab (Empfangsrichtung): aus einem decodeAll-Ergebnis die
// kleine, übertragbare Form (kompaktiere) und daraus die Anzeigedaten (baueEmpfang). Nichts wird nachgerechnet,
// alle Werte stammen aus demselben Lauf des Decoders.

import { toneSequence } from './symbols.js';
import { baueKette } from './kette.js';
import { NUM_SYMBOLS, SYNC_START, NUM_SYNC, LDPC_N } from './constants.js';

// sig: Eintrag aus decodeAll(...).signals, profil: das Profil der Decodierung
export function kompaktiere(sig, profil) {
  const r = sig.result;
  const powers = new Float32Array(NUM_SYMBOLS * 8);
  r.powers.forEach((z, i) => powers.set(z, i * 8));
  return {
    text: sig.text,
    startSec: sig.startSec,
    dtSec: sig.dtSec,
    f0: sig.f0,
    snrDb: sig.snrDb,
    score: sig.score,
    fenster: r.fenster,
    profil: { kt: profil.kt, kf: profil.kf, f0: profil.f0 },
    powers,
    llr: Float32Array.from(r.llr),
    bits174: Uint8Array.from(r.bits174),
    bp: { history: [...r.bp.history], iterations: r.bp.iterations, errors: r.bp.errors },
    crc: { extracted: r.crc.extracted, computed: r.crc.computed, ok: r.crc.ok },
  };
}

const dB = (p) => 10 * Math.log10(p + 1e-30);

export function baueEmpfang(zw) {
  if (!zw || !(zw.powers?.length === NUM_SYMBOLS * 8) || !(zw.llr?.length === LDPC_N) || !(zw.bits174?.length === LDPC_N)) {
    throw new RangeError('Zwischenwerte fehlen oder sind unvollständig');
  }
  const erwartet = toneSequence(Array.from(zw.bits174));
  const symbole = [];
  let trefferCostas = 0, trefferDaten = 0;
  for (let nr = 0; nr < NUM_SYMBOLS; nr++) {
    const roh = zw.powers.subarray(nr * 8, nr * 8 + 8);
    let staerkster = 0;
    for (let t = 1; t < 8; t++) if (roh[t] > roh[staerkster]) staerkster = t;
    const costas = SYNC_START.some((s) => nr >= s && nr < s + NUM_SYNC);
    const treffer = staerkster === erwartet[nr];
    if (treffer) { if (costas) trefferCostas++; else trefferDaten++; }
    symbole.push({ nr, art: costas ? 'costas' : 'daten', erwartet: erwartet[nr], staerkster, treffer, pegelDb: Array.from(roh, dB) });
  }
  const bits = Array.from(zw.llr, (llr, nr) => {
    const hart = llr > 0 ? 1 : 0;
    const endgueltig = zw.bits174[nr];
    return { nr, llr, hart, endgueltig, korrigiert: hart !== endgueltig, unsicher: Math.abs(llr) < 1 };
  });
  let kette = null;
  try { kette = baueKette(zw.text); } catch { kette = null; }
  return {
    symbole, trefferCostas, trefferDaten, trefferGesamt: trefferCostas + trefferDaten,
    bits,
    korrigiertAnzahl: bits.filter((b) => b.korrigiert).length,
    unsicherAnzahl: bits.filter((b) => b.unsicher).length,
    bp: { verlauf: zw.bp.history, durchlaeufe: zw.bp.iterations, fehler: zw.bp.errors },
    crc: zw.crc,
    kette,
  };
}
