// Mikrofon über getUserMedia und AudioWorklet: liefert 12-kHz-Blöcke und füllt einen Recorder, aus dem
// der Decoder später Zeitfenster nach UTC ausschneidet.
//
// Im Rohsignal-Modus (Vorgabe) sind Echo-, Rausch- und Pegelautomatik des Browsers aus. Auf den
// Testgeräten (Pixel 10a, Tablet mit Android 10, Chrome 155) hat das funktioniert (docs/messbericht_s1.md).

import { Recorder } from './recorder.js';
import { StartSchaetzer } from './startschaetzer.js';
import { oeffneMikrofon } from './audiogeraete.js';
import { SAMPLE_RATE, ringKapazitaetSec } from './profile.js';

// Zeit des ersten Abtastwerts: jetzt, minus Blockdauer, minus Eingangslatenz, minus Filterverzögerung
export const aufnahmeStartMs = (jetztMs, blockMs, eingangsLatenzMs, verzoegerungMs) => jetztMs - blockMs - eingangsLatenzMs - verzoegerungMs;

export class AudioIn {
  // jetzt: die Uhr der App (ausgeglichen, siehe clock.js), nicht die rohe Systemzeit
  // versatz: der aktuelle Ausgleich dieser Uhr (siehe Recorder)
  constructor({ onBlock = null, capacitySec = ringKapazitaetSec(), jetzt = () => Date.now(), versatz = () => 0 } = {}) {
    this.jetzt = jetzt;
    this.onBlock = onBlock;
    this.recorder = new Recorder({ rate: SAMPLE_RATE, capacitySec, versatz });
    this.schaetzer = new StartSchaetzer();
    this.ctx = null;
    this.strom = null;
    this.info = null;
    this.verzoegerungMs = 0; // Verzögerung des Resamplers
    this.eingangsLatenzMs = 0;
  }

  // Muss aus einer Nutzeraktion heraus aufgerufen werden
  async start({ deviceId = null, raw = true } = {}) {
    // Fehlt das gewählte Gerät (abgesteckt), läuft das Standardgerät und abweichung ist true
    const { stream, abweichung } = await oeffneMikrofon(deviceId, raw);
    this.strom = stream;
    const spur = this.strom.getAudioTracks()[0];
    const einstellungen = spur.getSettings();
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    const quelle = this.ctx.createMediaStreamSource(this.strom);
    const knoten = new AudioWorkletNode(this.ctx, 'ft8-capture');
    this.eingangsLatenzMs = (einstellungen.latency ?? 0) * 1000;
    this.info = { label: spur.label, einstellungen, rate: this.ctx.sampleRate, raw, abweichung };

    knoten.port.onmessage = (ev) => {
      const d = ev.data;
      if (d.bereit) { this.verzoegerungMs = d.delaySec * 1000; return; }
      if (this.recorder.startedAtMs === null) {
        const blockMs = (d.samples.length / SAMPLE_RATE) * 1000;
        this.recorder.starte(aufnahmeStartMs(this.jetzt(), blockMs, this.eingangsLatenzMs, this.verzoegerungMs));
      }
      this.recorder.push(d.samples);
      this.#fuehreStartNach();
      this.onBlock?.(d);
    };
    quelle.connect(knoten);
    return this.info;
  }

  // Bei jedem Block: Start neu schätzen (kleinste Verzögerung der letzten Minuten), siehe startschaetzer.js
  #fuehreStartNach() {
    const r = this.recorder;
    const sec = r.aufgenommenSec;
    const roh = r.imStartRahmen(this.jetzt()) - sec * 1000 - this.eingangsLatenzMs - this.verzoegerungMs;
    r.korrigiereStart(this.schaetzer.fuegeHinzu(sec, roh));
  }

  async stop() {
    for (const spur of this.strom?.getTracks() ?? []) spur.stop();
    await this.ctx?.close();
    this.ctx = null;
    this.strom = null;
    this.recorder.zuruecksetzen();
    this.schaetzer.zuruecksetzen();
  }
}
