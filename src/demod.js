// Demodulation bei bekannter Zeit und Frequenz: je Symbol die Leistung der acht Töne, daraus die
// Log-Likelihood-Verhältnisse (LLR) der 174 Bits.
//
// Jeder Ton wird mit einem komplexen Träger korreliert (Fenster: siehe symbolPowers). Bei ganzzahligem
// Modulationsindex (h = kf · kt) sind die Töne orthogonal, die Leistung eines Tons entspricht der
// Amplitude zum Quadrat (ein Sinus mit Amplitude 1 ergibt 1,0). Die LLR-Bildung folgt ft8_extract_likelihood
// und ftx_normalize_logl in ft8_lib/ft8/decode.c (MIT-Lizenz).

import { GRAY, NUM_SYMBOLS, NUM_DATA_SYMBOLS, LDPC_N } from './constants.js';
import { SAMPLE_RATE } from './profile.js';

// Leistung der 8 Töne je Symbol. startSec: Beginn von Symbol 0 in den samples. Was außerhalb der
// Aufnahme liegt, zählt als Stille.
//
// fenster 'rect': Korrelation über genau eine Symboldauer. Für reines Rauschen optimal, die Töne sind
//   orthogonal, aber unsynchrone Nachbarsignale streuen über die Nebenmaxima (-13 dB) herein.
// fenster 'hann2': Hann-Fenster über zwei Symboldauern, mittig auf dem Symbol (wie in ft8_lib). Die Nebenmaxima
//   sind viel kleiner, die Hauptkeule bleibt innerhalb des Tonabstands. Besser auf einem belegten Band.
export function symbolPowers(samples, profil, { startSec, f0 = profil.f0, fenster = 'rect' }) {
  const nsps = profil.symbolSamples;
  const start0 = Math.round(startSec * SAMPLE_RATE);
  const breit = fenster === 'hann2';
  if (!breit && fenster !== 'rect') throw new RangeError(`Unbekanntes Fenster ${fenster}`);
  const laenge = breit ? 2 * nsps : nsps;
  const vorlauf = breit ? nsps / 2 : 0; // das Fenster beginnt eine halbe Symboldauer vor dem Symbol

  // Träger je Ton über das Fenster, die Phase beginnt am Fensteranfang bei null (nur der Betrag zählt)
  const cos = [];
  const sin = [];
  for (let n = 0; n < 8; n++) {
    const w = (2 * Math.PI * (f0 + n * profil.toneSpacing)) / SAMPLE_RATE;
    cos.push(new Float64Array(laenge));
    sin.push(new Float64Array(laenge));
    for (let j = 0; j < laenge; j++) {
      const g = breit ? Math.sin((Math.PI * j) / laenge) ** 2 : 1; // Fensterwert
      cos[n][j] = g * Math.cos(w * j);
      sin[n][j] = g * Math.sin(w * j);
    }
  }

  const skala = 2 / nsps; // Summe der Fensterwerte ist bei beiden Formen gleich nsps
  const aus = [];
  for (let i = 0; i < NUM_SYMBOLS; i++) {
    const start = start0 + i * nsps - vorlauf;
    const leistung = new Float64Array(8);
    const von = Math.max(0, start);
    const bis = Math.min(samples.length, start + laenge);
    if (bis > von) {
      for (let n = 0; n < 8; n++) {
        let c = 0;
        let s = 0;
        const cn = cos[n];
        const sn = sin[n];
        for (let t = von; t < bis; t++) {
          const x = samples[t];
          c += x * cn[t - start];
          s += x * sn[t - start];
        }
        leistung[n] = (c * skala) ** 2 + (s * skala) ** 2;
      }
    }
    aus.push(leistung);
  }
  return aus;
}

const logLeistung = (p) => 10 * Math.log10(p + 1e-30);
const max4 = (a, b, c, d) => Math.max(a, b, c, d);

// LLR der 174 Bits: positiv = Bit 1. Datensymbole sind die Symbole 7 bis 35 und 43 bis 71.
export function llrFromPowers(powers) {
  const llr = new Float64Array(LDPC_N);
  const s2 = new Float64Array(8);
  for (let k = 0; k < NUM_DATA_SYMBOLS; k++) {
    const sym = k + (k < 29 ? 7 : 14);
    // s2[j] = Pegel des Tons, der zur Bitgruppe j gehört
    for (let j = 0; j < 8; j++) s2[j] = logLeistung(powers[sym][GRAY[j]]);
    llr[3 * k] = max4(s2[4], s2[5], s2[6], s2[7]) - max4(s2[0], s2[1], s2[2], s2[3]);
    llr[3 * k + 1] = max4(s2[2], s2[3], s2[6], s2[7]) - max4(s2[0], s2[1], s2[4], s2[5]);
    llr[3 * k + 2] = max4(s2[1], s2[3], s2[5], s2[7]) - max4(s2[0], s2[2], s2[4], s2[6]);
  }

  // Auf feste Varianz normieren (der Faktor 24 ist ein in ft8_lib experimentell gefundener Wert)
  let summe = 0;
  let summe2 = 0;
  for (let i = 0; i < LDPC_N; i++) { summe += llr[i]; summe2 += llr[i] * llr[i]; }
  const varianz = (summe2 - (summe * summe) / LDPC_N) / LDPC_N;
  if (varianz > 1e-12) {
    const faktor = Math.sqrt(24 / varianz);
    for (let i = 0; i < LDPC_N; i++) llr[i] *= faktor;
  }
  return llr;
}
