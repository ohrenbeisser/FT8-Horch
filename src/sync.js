// Suche nach Signalen: Costas-Korrelation über Zeit und Frequenz (grob), danach Feinabgleich.
//
// Grob: Ein Spektrogramm mit Vorschub von 1/4 Symbol und Bins im Abstand 1/(2 · Symboldauer) (FFT über zwei
// Symboldauern, passend zum Tonraster: 2h Bins je Tonabstand). Für jede Kombination aus Startzeit und Frequenz
// zählt die Summe über die 21 Costas-Symbole, um wie viele dB der erwartete Ton über dem Mittel der acht Töne
// liegt (Idee wie ft8_sync_score in ft8_lib, MIT-Lizenz, aber mit dem Mittel aller Töne statt der Nachbarn).
// Fein: Die Energie der erwarteten Costas-Töne wird mit exakten Korrelatoren über Zeit und Frequenz in
// immer kleineren Schritten maximiert.

import { MixedFft } from './fft.js';
import { COSTAS, SYNC_START, NUM_SYMBOLS, NUM_SYNC } from './constants.js';
import { SAMPLE_RATE } from './profile.js';

const OSR = 4; // Zeitraster: Vorschub = Symboldauer / OSR
const NYQUIST_GRENZE = 5500;

// Symbolnummern der 21 Costas-Symbole mit dem zugehörigen Ton
const COSTAS_SYMBOLE = SYNC_START.flatMap((s) => Array.from({ length: NUM_SYNC }, (_, k) => ({ symbol: s + k, ton: COSTAS[k] })));

// ---------------------------------------------------------------------------------------------
// Grobsuche

// Zeilen des Spektrogramms (dB je Bin) für die Vorschubindizes rVon bis rBis (einschließlich).
// Je zwei reelle Zeilen teilen sich eine komplexe FFT (Zeile A im Real-, Zeile B im Imaginärteil).
function spektrogramm(samples, nsps, hop, rVon, rBis, binVon, binBis) {
  const nfft = 2 * nsps;
  const fft = new MixedFft(nfft);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const nBins = binBis - binVon + 1;
  const zeilen = rBis - rVon + 1;
  const db = new Float32Array(zeilen * nBins);
  const skala = 2 / nsps;

  // Zeilen, die ganz oder teilweise außerhalb der Aufnahme liegen, bekommen die fehlenden Werte als Stille
  const fuelle = (ziel, r) => {
    const von = Math.max(0, -r * hop);
    const bis = Math.min(nsps, samples.length - r * hop);
    for (let i = von; i < bis; i++) ziel[i] = samples[r * hop + i];
  };
  for (let r = rVon; r <= rBis; r += 2) {
    const a = r;
    const b = r + 1 <= rBis ? r + 1 : -1;
    re.fill(0);
    im.fill(0);
    fuelle(re, a);
    if (b >= 0) fuelle(im, b);
    fft.forward(re, im);
    for (let k = binVon; k <= binBis; k++) {
      const k2 = (nfft - k) % nfft;
      // Zerlegung der beiden reellen Spektren aus dem gemeinsamen Ergebnis
      const ar = 0.5 * (re[k] + re[k2]);
      const ai = 0.5 * (im[k] - im[k2]);
      const br = 0.5 * (im[k] + im[k2]);
      const bi = -0.5 * (re[k] - re[k2]);
      db[(a - rVon) * nBins + (k - binVon)] = 10 * Math.log10((skala * skala) * (ar * ar + ai * ai) + 1e-30);
      if (b >= 0) db[(b - rVon) * nBins + (k - binVon)] = 10 * Math.log10((skala * skala) * (br * br + bi * bi) + 1e-30);
    }
  }
  return { db, nBins, zeilen };
}

// Liste der besten Kandidaten, absteigend nach Punktzahl.
// opt.leadSec: Vorlauf, um den die Aufnahme vor dem Beginn des Zeitfensters startet (samples[0] liegt bei Fensterbeginn minus leadSec).
// startMinSec/startMaxSec: Bereich für den Beginn des ersten Symbols (Standard: Vorgabe 0,5 s · kt + leadSec, ± 2,5 s · kt;
// der Beginn darf vor der Aufnahme liegen, dann fehlen die ersten Symbole).
// fMin/fMax: Bereich für die Frequenz von Ton 0.
export function findCandidates(samples, profil, opt = {}) {
  const nsps = profil.symbolSamples;
  const hop = nsps / OSR;
  const signalSamples = NUM_SYMBOLS * nsps;
  const nennStart = profil.startOffsetSec + (opt.leadSec ?? 0);
  const spanne = 2.5 * profil.kt;
  // Signale dürfen schon vor dem Beginn der Aufnahme starten; der fehlende Anfang zählt als Stille
  const startMin = Math.round((opt.startMinSec ?? nennStart - spanne) * SAMPLE_RATE);
  const startMax = Math.min(samples.length - signalSamples, Math.round((opt.startMaxSec ?? nennStart + spanne) * SAMPLE_RATE));
  if (startMax < startMin) return [];
  const maxKandidaten = opt.maxCandidates ?? 100;

  const binHz = SAMPLE_RATE / (2 * nsps);
  const bpt = Math.round(profil.toneSpacing / binHz); // Bins je Tonabstand (= 2h)
  const fMax = Math.min(opt.fMax ?? 3000, NYQUIST_GRENZE - 8 * profil.toneSpacing);
  const binLo = Math.max(1, Math.floor((opt.fMin ?? 200) / binHz));
  const binHi = Math.ceil(fMax / binHz);
  if (binHi < binLo) return [];

  const tauVon = Math.ceil(startMin / hop);
  const tauBis = Math.floor(startMax / hop);
  if (tauBis < tauVon) return [];
  const rBis = tauBis + (NUM_SYMBOLS - 1) * OSR;
  const { db, nBins } = spektrogramm(samples, nsps, hop, tauVon, rBis, binLo, binHi + 7 * bpt);

  // Mittel der acht Töne je Zeile und Anfangsbin
  const nKand = binHi - binLo + 1;
  const zeilen = rBis - tauVon + 1;
  const mittel = new Float32Array(zeilen * nKand);
  for (let r = 0; r < zeilen; r++) {
    const z = r * nBins;
    for (let b = 0; b < nKand; b++) {
      let s = 0;
      for (let n = 0; n < 8; n++) s += db[z + b + n * bpt];
      mittel[r * nKand + b] = s / 8;
    }
  }

  const nTau = tauBis - tauVon + 1;
  const punkte = new Float32Array(nTau * nKand);
  let summe = 0;
  let summe2 = 0;
  for (let t = 0; t < nTau; t++) {
    for (let b = 0; b < nKand; b++) {
      let s = 0;
      for (const { symbol, ton } of COSTAS_SYMBOLE) {
        const r = t + symbol * OSR;
        s += db[r * nBins + b + ton * bpt] - mittel[r * nKand + b];
      }
      punkte[t * nKand + b] = s;
      summe += s;
      summe2 += s * s;
    }
  }
  const anzahl = nTau * nKand;
  const mw = summe / anzahl;
  const abw = Math.sqrt(Math.max(summe2 / anzahl - mw * mw, 0));
  const schwelle = mw + (opt.schwelleSigma ?? 3.5) * abw;

  const kandidaten = [];
  for (let i = 0; i < anzahl; i++) if (punkte[i] > schwelle) kandidaten.push(i);
  kandidaten.sort((a, b) => punkte[b] - punkte[a]);

  // Nachbarn eines besseren Kandidaten unterdrücken
  const angenommen = [];
  for (const i of kandidaten) {
    const t = Math.floor(i / nKand);
    const b = i % nKand;
    if (angenommen.some((a) => Math.abs(a.t - t) <= OSR && Math.abs(a.b - b) <= bpt)) continue;
    angenommen.push({ t, b, score: punkte[i] });
    if (angenommen.length >= maxKandidaten) break;
  }
  return angenommen.map(({ t, b, score }) => {
    const startSample = (tauVon + t) * hop;
    return { startSample, startSec: startSample / SAMPLE_RATE, f0: (binLo + b) * binHz, score, binHz };
  });
}

// ---------------------------------------------------------------------------------------------
// Feinabgleich

// Energie (Amplitude zum Quadrat) der 21 erwarteten Costas-Töne bei Startabtastwert und Grundfrequenz f0
function costasEnergie(samples, nsps, toneSpacing, startSample, f0) {
  let summe = 0;
  const skala = (2 / nsps) ** 2;
  for (const { symbol, ton } of COSTAS_SYMBOLE) {
    const start = startSample + symbol * nsps;
    if (start < 0 || start + nsps > samples.length) continue;
    const w = (2 * Math.PI * (f0 + ton * toneSpacing)) / SAMPLE_RATE;
    const dr = Math.cos(w);
    const di = -Math.sin(w);
    let pr = 1;
    let pi = 0;
    let c = 0;
    let s = 0;
    for (let t = 0; t < nsps; t++) {
      const x = samples[start + t];
      c += x * pr;
      s += x * pi;
      const nr = pr * dr - pi * di;
      pi = pr * di + pi * dr;
      pr = nr;
    }
    summe += skala * (c * c + s * s);
  }
  return summe;
}

// Verbessert Startzeit und Frequenz eines Kandidaten durch Maximieren der Costas-Energie
export function refineCandidate(samples, profil, kandidat) {
  const nsps = profil.symbolSamples;
  let start = kandidat.startSample;
  let f0 = kandidat.f0;
  let beste = costasEnergie(samples, nsps, profil.toneSpacing, start, f0);
  const binHz = kandidat.binHz ?? SAMPLE_RATE / (2 * nsps);

  for (let stufe = 1; stufe <= 6; stufe++) {
    const schrittZeit = Math.max(1, Math.round(nsps / (4 * 2 ** stufe)));
    const schrittFreq = binHz / 2 ** stufe;
    for (let runde = 0; runde < 2; runde++) {
      for (const d of [-schrittZeit, schrittZeit]) {
        const e = costasEnergie(samples, nsps, profil.toneSpacing, start + d, f0);
        if (e > beste) { beste = e; start += d; }
      }
      for (const d of [-schrittFreq, schrittFreq]) {
        const e = costasEnergie(samples, nsps, profil.toneSpacing, start, f0 + d);
        if (e > beste) { beste = e; f0 += d; }
      }
    }
  }
  return { startSample: start, startSec: start / SAMPLE_RATE, f0, energie: beste };
}

// ---------------------------------------------------------------------------------------------
// Rauschabstand

// Schätzt den Rauschabstand (Bezug 2500 Hz) aus den Tonleistungen eines decodierten Signals.
// Signal: mittlere Leistung der gesendeten Töne abzüglich Rauschen. Rauschen: Median der übrigen sieben
// Töne je Symbol (der Median einer Exponentialverteilung ist ln 2 mal der Mittelwert).
export function estimateSnr(powers, tones, profil) {
  const nsps = profil.symbolSamples;
  let sig = 0;
  const anderes = [];
  for (let i = 0; i < powers.length; i++) {
    sig += powers[i][tones[i]];
    for (let n = 0; n < 8; n++) if (n !== tones[i]) anderes.push(powers[i][n]);
  }
  sig /= powers.length;
  anderes.sort((a, b) => a - b);
  const rauschen = anderes[Math.floor(anderes.length / 2)] / Math.LN2;
  const netto = Math.max(sig - rauschen, rauschen * 1e-3);
  // Herleitung: Weißes Rauschen mit Varianz s² je Abtastwert hat im Tonfach (Skala 2 / nsps) die Leistung Pn = 4 s² / nsps.
  // Ein Sinus mit Amplitude A zeigt Psig = A² und hat die Signalleistung A² / 2. Die Rauschleistung in 2500 Hz ist
  // s² · 2500 / 6000 (die Varianz verteilt sich über 6000 Hz). Also
  // SNR = (Psig / 2) / (Pn · nsps / 4 · 2500 / 6000) = Psig / Pn · 2 · 6000 / (nsps · 2500) = Psig / Pn · 4,8 / nsps
  return 10 * Math.log10((netto / rauschen) * (4.8 / nsps));
}
