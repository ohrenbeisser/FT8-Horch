// Spektrogramm für den Wasserfall: Hann-Fenster, FFT, Pegel in dBFS (ein Sinus mit Vollaussteuerung
// zeigt 0 dB).

import { Fft, hann } from './fft.js';

export class Spectrogram {
  constructor({ rate = 12000, fftSize = 4096, hop = 1024 } = {}) {
    this.rate = rate;
    this.fftSize = fftSize;
    this.hop = hop;
    this.binHz = rate / fftSize;
    this.fft = new Fft(fftSize);
    this.fenster = hann(fftSize);
    this.fensterSumme = this.fenster.reduce((a, b) => a + b, 0);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.offen = new Float32Array(0);
  }

  freqToBin(f) {
    return Math.round(f / this.binHz);
  }

  binToFreq(k) {
    return k * this.binHz;
  }

  // Nimmt Abtastwerte entgegen und liefert die fertigen Zeilen (dB je Bin von 0 Hz bis rate / 2)
  push(samples) {
    const alle = new Float32Array(this.offen.length + samples.length);
    alle.set(this.offen);
    alle.set(samples, this.offen.length);
    let pos = 0;
    const zeilen = [];
    const n = this.fftSize;
    while (alle.length - pos >= n) {
      for (let i = 0; i < n; i++) {
        this.re[i] = alle[pos + i] * this.fenster[i];
        this.im[i] = 0;
      }
      this.fft.forward(this.re, this.im);
      const zeile = new Float32Array(n / 2 + 1);
      for (let k = 0; k <= n / 2; k++) {
        const betrag = Math.hypot(this.re[k], this.im[k]);
        zeile[k] = 20 * Math.log10((2 * betrag) / this.fensterSumme + 1e-12);
      }
      zeilen.push(zeile);
      pos += this.hop;
    }
    this.offen = alle.slice(pos);
    return zeilen;
  }
}

// Eine Zeile auf Bildpunkte abbilden: je Bildpunkt das Maximum der Bins im Frequenzbereich des Punktes
export function rowToPixels(zeile, binHz, fMin, fMax, breite) {
  if (!(fMax > fMin) || breite < 1) throw new RangeError('Ungültiger Frequenzbereich oder Breite');
  const pixel = new Float32Array(breite);
  const proPixel = (fMax - fMin) / breite;
  const letzter = zeile.length - 1;
  for (let x = 0; x < breite; x++) {
    const von = Math.min(letzter, Math.max(0, Math.round((fMin + x * proPixel) / binHz)));
    const bis = Math.min(letzter, Math.max(von, Math.round((fMin + (x + 1) * proPixel) / binHz) - 1));
    let m = -Infinity;
    for (let k = von; k <= bis; k++) if (zeile[k] > m) m = zeile[k];
    pixel[x] = m;
  }
  return pixel;
}
