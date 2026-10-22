// Spektrogramm für die Signal-Vorschau im Codierungs-Tab. Fenster = genau ein Symbol mit Hann-Gewichtung (ein
// Rechteckfenster zeigt bei langen Folgen gleicher Töne breite Nebenmaxima), Nullen angehängt für glatte Bilder.
// Eine Zeile je Viertelsymbol, die Zeile 4·i + 2 liegt genau in der Mitte von Symbol i. Abtastwert 0 des Signals
// ist Zeile 0.

import { Fft } from './fft.js';
import { SAMPLE_RATE } from './profile.js';

const zweierpotenz = (n) => 2 ** Math.ceil(Math.log2(n));

export function vorschauSpektrogramm(signal, profil) {
  const nsps = profil.symbolSamples;
  const hop = nsps / 4;
  const n = Math.max(8192, zweierpotenz(2 * nsps));
  const fft = new Fft(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const binHz = SAMPLE_RATE / n;
  const fLo = profil.f0 - 2 * profil.toneSpacing - 6;
  const fHi = profil.f0 + 9 * profil.toneSpacing + 6;
  const kLo = Math.floor(fLo / binHz);
  const kHi = Math.ceil(fHi / binHz);
  const symbole = Math.round(signal.length / nsps);
  const fenster = Float64Array.from({ length: nsps }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / nsps));
  const summe = fenster.reduce((a, b) => a + b, 0);
  const zeilen = [];
  for (let r = 0; r <= symbole * 4; r++) {
    const start = Math.round(r * hop - nsps / 2);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < nsps; i++) {
      const k = start + i;
      if (k >= 0 && k < signal.length) re[i] = signal[k] * fenster[i];
    }
    fft.forward(re, im);
    const z = new Float32Array(kHi - kLo + 1);
    for (let k = kLo; k <= kHi; k++) z[k - kLo] = 20 * Math.log10((2 * Math.hypot(re[k], im[k])) / summe + 1e-9);
    zeilen.push(z);
  }
  return { zeilen, fLo: kLo * binHz, fHi: kHi * binHz, binHz };
}
