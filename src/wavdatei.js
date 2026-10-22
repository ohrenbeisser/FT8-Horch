// WAV-Dateien für die App: Aufnahme eines Fensters speichern, Sendesignal speichern, fremde Datei lesen und decodieren.
// Die Namen der Dateien tragen Zeitfaktor, Tonabstandfaktor und Vorlauf, damit sich eine gespeicherte Aufnahme später
// wieder richtig decodieren lässt (ein Profil gehört nicht in eine WAV-Datei).
import { decodeWav } from './wav.js';
import { Resampler } from './resample.js';
import { SAMPLE_RATE, KT_WERTE, KF_WERTE } from './profile.js';

const zwei = (n) => String(n).padStart(2, '0');
const stempel = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${zwei(d.getUTCMonth() + 1)}${zwei(d.getUTCDate())}_${zwei(d.getUTCHours())}${zwei(d.getUTCMinutes())}${zwei(d.getUTCSeconds())}`;
};

// Name einer Aufnahme: Beginn des Fensters (UTC), Profil, Vorlauf vor dem Fensterbeginn
export const dateinameAufnahme = ({ startMs, kt, kf, vorlaufSec }) => `ft8-horch_aufnahme_${stempel(startMs)}_kt${kt}_kf${kf}_vorlauf${vorlaufSec}s.wav`;

// Name eines Sendesignals: Text (nur Zeichen, die in Dateinamen unbedenklich sind), Frequenz, Profil
export function dateinameSignal({ text, f0, kt, kf }) {
  const t = String(text).toUpperCase().replace(/[^A-Z0-9+]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'signal';
  return `ft8-horch_signal_${t}_${Math.round(f0)}Hz_kt${kt}_kf${kf}.wav`;
}

// Profilangaben aus dem Dateinamen: { kt, kf, vorlaufSec }, was fehlt oder nicht passt, bleibt undefined
export function leseDateiname(name) {
  const aus = {};
  const kt = /_kt(\d+)/.exec(name);
  const kf = /_kf(\d+)/.exec(name);
  const vl = /_vorlauf(\d+(?:\.\d+)?)s/.exec(name);
  if (kt && KT_WERTE.includes(Number(kt[1]))) aus.kt = Number(kt[1]);
  if (kf && KF_WERTE.includes(Number(kf[1]))) aus.kf = Number(kf[1]);
  if (vl) aus.vorlaufSec = Number(vl[1]);
  return aus;
}

// Bytes einer WAV-Datei -> 12-kHz-Abtastwerte (mono) für den Decoder
export function leseAudiodatei(bytes) {
  const { samples, sampleRate } = decodeWav(bytes);
  if (!samples.length) throw new RangeError('Keine Audiodaten gefunden');
  const dauerSec = samples.length / sampleRate;
  if (sampleRate === SAMPLE_RATE) return { samples, quellRate: sampleRate, dauerSec };
  const r = new Resampler(sampleRate, SAMPLE_RATE);
  const aus = r.push(samples);
  return { samples: aus, quellRate: sampleRate, dauerSec };
}

// Ein Signal im Takt eines Fensters: Abweichung vom Raster in Sekunden (−Fenster/2 bis +Fenster/2) und Nummer des Fensters (ab 1)
export function lageImFenster(startSec, { vorlaufSec, profil }) {
  const rel = startSec - vorlaufSec - profil.startOffsetSec;
  const nr = Math.floor((rel + profil.slotSec / 2) / profil.slotSec);
  return { dtSec: rel - nr * profil.slotSec, fenster: nr + 1 };
}

// Längste Datei, die der Decoder auf einmal durchsucht (der Speicher der Suche wächst mit der Länge)
export const maxDateiSec = (profil, vorlaufSec) => 4 * profil.slotSec + vorlaufSec;
