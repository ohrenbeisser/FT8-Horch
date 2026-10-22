// AudioWorklet: Mikrofon -> 12 kHz, in Blöcken von etwa 100 ms an die Seite.
// Die Umrechnung steckt in capture-core.js (getestet), hier ist nur die Anbindung an den Browser.
import { CaptureCore } from './capture-core.js';

class Aufnahme extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = new CaptureCore(sampleRate, 12000, 0.1); // sampleRate: Rate des AudioContext
    this.port.postMessage({ bereit: true, delaySec: this.kern.delaySec, inRate: sampleRate });
  }

  process(eingaenge) {
    const kanal = eingaenge[0]?.[0];
    if (kanal) {
      const block = this.kern.process(kanal);
      if (block) this.port.postMessage(block, [block.samples.buffer]);
    }
    return true;
  }
}
registerProcessor('ft8-capture', Aufnahme);
