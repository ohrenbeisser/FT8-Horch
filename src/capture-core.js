// Kern des Aufnahme-Worklets, frei von Browser-Objekten und deshalb testbar: nimmt die 128er-Blöcke
// des Mikrofons entgegen, rechnet auf 12 kHz um und gibt etwa alle 100 ms einen Block weiter.

import { Resampler } from './resample.js';

const CLIP_SCHWELLE = 0.999;

export class CaptureCore {
  constructor(inRate, outRate = 12000, blockSec = 0.1) {
    this.resampler = new Resampler(inRate, outRate);
    this.blockLaenge = Math.max(1, Math.round(blockSec * outRate));
    this.wartend = [];
    this.wartendAnzahl = 0;
    this.peak = 0;
    this.delaySec = this.resampler.delaySec;
  }

  // Gibt { samples, peak, clipped } zurück, sobald ein Block voll ist, sonst null
  process(frame) {
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i]);
      if (a > this.peak) this.peak = a;
    }
    const aus = this.resampler.push(frame);
    if (aus.length) {
      this.wartend.push(aus);
      this.wartendAnzahl += aus.length;
    }
    if (this.wartendAnzahl < this.blockLaenge) return null;

    const samples = new Float32Array(this.wartendAnzahl);
    let pos = 0;
    for (const w of this.wartend) { samples.set(w, pos); pos += w.length; }
    const ergebnis = { samples, peak: this.peak, clipped: this.peak >= CLIP_SCHWELLE };
    this.wartend = [];
    this.wartendAnzahl = 0;
    this.peak = 0;
    return ergebnis;
  }
}
