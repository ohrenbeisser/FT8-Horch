// Tonerzeugung: 8-GFSK mit Gaußfilter (BT = 2,0) und Rampe, alles aus dem Profil abgeleitet.
//
// Das Verfahren folgt synth_gfsk aus ft8_lib (demo/gen_ft8.c, MIT-Lizenz): Jeder Ton verschiebt
// die Frequenz um n · Δf. Ein Gaußimpuls glättet die Übergänge, die Phase wird fortlaufend
// aufsummiert. Der Impuls hängt nur vom Verhältnis zur Symboldauer ab, Rampe und Impuls skalieren
// deshalb mit kt von selbst. Der Modulationsindex h = kf · kt bestimmt den Tonabstand.

import { SAMPLE_RATE } from './profile.js';
import { NUM_SYMBOLS } from './constants.js';

const BT = 2.0; // Bandbreite-Zeit-Produkt des Gaußfilters
const GFSK_K = Math.PI * Math.sqrt(2 / Math.LN2); // 5,336446
const ZWEI_PI = 2 * Math.PI;

// Fehlerfunktion. JavaScript hat Math.erf nicht. Reihe für kleine Werte, Kettenbruch für große.
export function erf(x) {
  const a = Math.abs(x);
  const vorzeichen = x < 0 ? -1 : 1;
  if (a >= 6) return vorzeichen;
  if (a < 2.5) {
    let term = a;
    let summe = a;
    for (let n = 1; n < 200; n++) {
      term *= -(a * a) / n;
      const zuwachs = term / (2 * n + 1);
      summe += zuwachs;
      if (Math.abs(zuwachs) < 1e-17) break;
    }
    return vorzeichen * (2 / Math.sqrt(Math.PI)) * summe;
  }
  let t = a;
  for (let k = 80; k >= 1; k--) t = a + k / 2 / t;
  const erfc = Math.exp(-(a * a)) / (Math.sqrt(Math.PI) * t);
  return vorzeichen * (1 - erfc);
}

// Gaußimpuls über 3 Symboldauern
export function gfskPulse(nsps) {
  const puls = new Float64Array(3 * nsps);
  for (let i = 0; i < puls.length; i++) {
    const t = i / nsps - 1.5;
    puls[i] = (erf(GFSK_K * BT * (t + 0.5)) - erf(GFSK_K * BT * (t - 0.5))) / 2;
  }
  return puls;
}

// 79 Töne -> Wellenform (79 Symbole lang, Pegel bis 1,0)
export function synthesizeGfsk(tones, profil) {
  if (tones.length !== NUM_SYMBOLS) throw new RangeError(`${NUM_SYMBOLS} Töne erwartet, ${tones.length} erhalten`);
  if (!tones.every((t) => Number.isInteger(t) && t >= 0 && t <= 7)) throw new RangeError('Töne müssen ganze Zahlen von 0 bis 7 sein');

  const nsps = profil.symbolSamples;
  const nWave = NUM_SYMBOLS * nsps;
  const spitze = (ZWEI_PI * profil.modIndex) / nsps; // Frequenzhub für Ton 1 in rad je Abtastwert

  // Frequenzverlauf: Grundfrequenz plus geglättete Tonsprünge. Je ein Zusatzsymbol vorn und hinten.
  const dphi = new Float64Array(nWave + 2 * nsps).fill((ZWEI_PI * profil.f0) / SAMPLE_RATE);
  const puls = gfskPulse(nsps);
  for (let i = 0; i < NUM_SYMBOLS; i++) {
    const ib = i * nsps;
    const hub = spitze * tones[i];
    if (hub === 0) continue;
    for (let j = 0; j < 3 * nsps; j++) dphi[ib + j] += hub * puls[j];
  }
  // Zusatzsymbole mit dem Ton des ersten und letzten Symbols, damit Anfang und Ende nicht abfallen
  for (let j = 0; j < 2 * nsps; j++) {
    dphi[j] += spitze * puls[j + nsps] * tones[0];
    dphi[j + nWave] += spitze * puls[j] * tones[NUM_SYMBOLS - 1];
  }

  const signal = new Float32Array(nWave);
  let phi = 0;
  for (let k = 0; k < nWave; k++) {
    signal[k] = Math.sin(phi);
    phi = (phi + dphi[k + nsps]) % ZWEI_PI;
  }

  // Rampe über 1/8 Symbol an Anfang und Ende (im Standard 20 ms)
  const nRampe = nsps / 8;
  for (let i = 0; i < nRampe; i++) {
    const huellkurve = (1 - Math.cos((ZWEI_PI * i) / (2 * nRampe))) / 2;
    signal[i] *= huellkurve;
    signal[nWave - 1 - i] *= huellkurve;
  }
  return signal;
}

// Wellenform im Zeitfenster des Profils: Stille, Signal ab Startversatz, Stille
export function renderSlot(tones, profil) {
  const signal = synthesizeGfsk(tones, profil);
  const slot = new Float32Array(Math.round(profil.slotSec * SAMPLE_RATE));
  slot.set(signal, profil.startOffsetSamples);
  return slot;
}
