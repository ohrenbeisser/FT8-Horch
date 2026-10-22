// Anzeigedaten für den Codierungs-Tab: die Kette von der Nachricht bis zu den 79 Tönen und das Lehrbeispiel
// zum Fehlerschutz (Bits kippen, Belief Propagation). Rechnet nur mit den echten Modulen des Senders
// (pack77, crc14, ldpc, symbols), nichts wird nachgebaut.

import { encodeMessage } from './encoder.js';
import { unpackMessage } from './pack77.js';
import { crc14 } from './crc14.js';
import { ldpcCheck, bpDecode } from './ldpc.js';
import { mulberry32, gauss } from './rauschen.js';
import { llrFromPowers } from './demod.js';
import { COSTAS, NUM_SYNC, SYNC_START, LDPC_N } from './constants.js';
import { toneSequence } from './symbols.js';

// Die drei Abschnitte des 174-Bit-Codeworts
export const BIT_ABSCHNITTE = [
  { id: 'nutz', von: 0, bis: 77 },
  { id: 'crc', von: 77, bis: 91 },
  { id: 'parity', von: 91, bis: 174 },
];

export function baueKette(text) {
  if (!text || !text.trim()) throw new Error('Nachricht fehlt');
  const e = encodeMessage(text.trim());
  const felder = e.message.fields.map((f) => ({ ...f, bits: e.bits77.slice(f.start, f.start + f.length) }));
  const gruppen = e.groups.map((g, i) => ({ nummer: i + 1, bits: g.bits, ton: g.tone }));
  // Reihenfolge der 79 Symbole: Costas, 29 Datensymbole, Costas, 29 Datensymbole, Costas
  const symbole = e.tones.map((ton, nr) => {
    const block = SYNC_START.findIndex((s) => nr >= s && nr < s + NUM_SYNC);
    if (block >= 0) return { nr, ton, art: 'costas', block: block + 1, position: nr - SYNC_START[block] };
    const datenIndex = nr < SYNC_START[1] ? nr - NUM_SYNC : nr - NUM_SYNC - NUM_SYNC; // 0 bis 57
    return { nr, ton, art: 'daten', gruppe: datenIndex + 1 };
  });
  return {
    text: e.message.text,
    typ: { art: e.message.type, i3: e.message.i3, n3: e.message.n3 },
    felder,
    bits77: e.bits77,
    crc: { bits: e.bits91.slice(77), wert: parseInt(e.bits91.slice(77).join(''), 2) },
    bits91: e.bits91,
    paritaet: e.parity,
    bits174: e.bits174,
    gruppen,
    symbole,
    costas: COSTAS,
  };
}

// Kopie mit gekippten Bits (die Eingabe bleibt unverändert)
export function kippe(bits, indizes) {
  const neu = bits.slice();
  for (const i of indizes) neu[i] ^= 1;
  return neu;
}

// n verschiedene zufällige Bitpositionen, bei gleichem Startwert immer dieselben
export function zufallsFehler(laenge, n, seed = 1) {
  if (n > laenge) throw new RangeError(`${n} Fehler passen nicht in ${laenge} Bits`);
  const zufall = mulberry32(seed);
  const frei = Array.from({ length: laenge }, (_, i) => i);
  for (let i = frei.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [frei[i], frei[j]] = [frei[j], frei[i]];
  }
  return frei.slice(0, n).sort((a, b) => a - b);
}

// Fehlerschutz mit LLR als Eingang: positiv = Bit 1, der Betrag sagt, wie sicher. Das ist der Weg des echten Decoders.
// original: das gesendete Codewort (nur zum Vergleichen, der Decoder sieht es nicht).
export function korrigiereMitLlr(llr, original, { maxIterationen = 25 } = {}) {
  if (llr.length !== LDPC_N) throw new RangeError(`${LDPC_N} LLR-Werte erwartet`);
  const fehlerVorher = ldpcCheck(Array.from(llr, (v) => (v > 0 ? 1 : 0)));
  const bp = bpDecode(llr, maxIterationen);
  const gueltig = bp.errors === 0;
  const bits77 = bp.bits.slice(0, 77);
  const crcOk = gueltig && crc14([...bits77, 0, 0, 0, 0, 0]) === parseInt(bp.bits.slice(77, 91).join(''), 2);
  let text = null;
  if (crcOk) { try { text = unpackMessage(bits77).text; } catch { text = null; } }
  const falsch = bp.bits.reduce((n, b, i) => n + (b !== original[i] ? 1 : 0), 0);
  return {
    fehlerVorher,
    verlauf: bp.history,
    iterationen: bp.iterations,
    bitsNachher: bp.bits,
    falscheBitsNachher: falsch,
    gueltigesCodewort: gueltig,
    korrigiert: gueltig && falsch === 0,
    crcOk,
    text,
  };
}

// Lehrdarstellung mit harten Bits: Der Decoder kennt nur 0 oder 1 je Bit, jedes mit gleichem Vertrauen.
// Der echte Decoder hat weiche Werte (siehe simuliereKanal) und schafft deutlich mehr.
const HARTES_VERTRAUEN = 4;

export function pruefeUndKorrigiere(empfangen, original, optionen = {}) {
  if (empfangen.length !== LDPC_N) throw new RangeError(`${LDPC_N} Bits erwartet`);
  return korrigiereMitLlr(empfangen.map((b) => (b ? HARTES_VERTRAUEN : -HARTES_VERTRAUEN)), original, optionen);
}

// Simulierter Kanal für die Lehrkarte: Jedes der 79 Symbole ist ein Ton aus acht orthogonalen Tönen, die Messung
// jedes Tons ist komplexes Gauß-Rauschen, beim gesendeten Ton kommt die Symbolenergie dazu. Aus den Leistungen bildet
// die App dieselben LLR wie der echte Decoder (demod.js). Rauschabstand wie bei FT8 üblich auf 2500 Hz bezogen,
// Symbolenergie zu Rauschleistungsdichte = SNR · 2500 / Symbolrate, die Symbolrate ist 6,25 Baud / kt.
// Gemessen (200 Versuche je Wert, Standardprofil): Die Hälfte der Versuche gelingt mit LLR bei etwa −19,8 dB (echter
// Decoder: −19,6 dB), mit harten Bits bei etwa −18,8 dB.
export function simuliereKanal(bits174, { snrDb, kt = 1, seed = 1 }) {
  const zufall = mulberry32(seed);
  const esN0 = (2500 / (6.25 / kt)) * 10 ** (snrDb / 10);
  const amplitude = Math.sqrt(esN0);
  const toene = toneSequence(Array.from(bits174));
  const powers = toene.map((ton) => {
    const p = new Float64Array(8);
    for (let j = 0; j < 8; j++) {
      const re = (j === ton ? amplitude : 0) + gauss(zufall) * Math.SQRT1_2;
      const im = gauss(zufall) * Math.SQRT1_2;
      p[j] = re * re + im * im;
    }
    return p;
  });
  const llr = llrFromPowers(powers);
  const harteBits = Array.from(llr, (v) => (v > 0 ? 1 : 0));
  return { llr, harteBits, hartFehler: harteBits.reduce((n, b, i) => n + (b !== bits174[i] ? 1 : 0), 0) };
}

// Dieselbe Störung, zwei Decoder: nur harte Bits gegen weiche Werte
export function vergleicheDecoder(bits174, optionen) {
  const kanal = simuliereKanal(bits174, optionen);
  return {
    kanal,
    fehlerHart: kanal.hartFehler,
    hart: pruefeUndKorrigiere(kanal.harteBits, bits174),
    weich: korrigiereMitLlr(kanal.llr, bits174),
  };
}

// Wie oft gelingt es? n Versuche mit wechselndem Rauschen
export function haeufigkeit(bits174, { snrDb, kt = 1, n = 100, seed0 = 1000 }) {
  let weich = 0, hart = 0, fehler = 0;
  for (let i = 0; i < n; i++) {
    const v = vergleicheDecoder(bits174, { snrDb, kt, seed: seed0 + i });
    if (v.weich.korrigiert) weich++;
    if (v.hart.korrigiert) hart++;
    fehler += v.fehlerHart;
  }
  return { n, weich, hart, mittlereFehler: fehler / n };
}
