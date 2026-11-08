import { ringKapazitaetSec } from './profile.js';

// Aufnahmepuffer: die letzten Sekunden der 12-kHz-Aufnahme mit absoluter Zählung, dazu die
// Zuordnung von Abtastindex zu UTC-Zeit, damit der Decoder ein Zeitfenster ausschneiden kann.

export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.daten = new Float32Array(capacity);
    this.total = 0; // insgesamt geschriebene Werte
  }

  get oldest() {
    return Math.max(0, this.total - this.capacity);
  }

  push(block) {
    const quelle = block.length > this.capacity ? block.subarray(block.length - this.capacity) : block;
    this.total += block.length - quelle.length; // übersprungene Werte zählen mit
    let pos = this.total % this.capacity;
    for (let i = 0; i < quelle.length; i++) {
      this.daten[pos] = quelle[i];
      if (++pos === this.capacity) pos = 0;
    }
    this.total += quelle.length;
  }

  // Werte ab absolutem Index; null, wenn sie nicht (mehr oder noch nicht) im Puffer liegen
  read(start, laenge) {
    if (start < this.oldest || start + laenge > this.total) return null;
    const aus = new Float32Array(laenge);
    for (let i = 0; i < laenge; i++) aus[i] = this.daten[(start + i) % this.capacity];
    return aus;
  }
}

export class Recorder {
  // versatz: der aktuelle Ausgleich der App-Uhr in ms (Uhr = Systemzeit + versatz). Ändert er sich nach dem Start der
  // Aufnahme, folgen indexAt und utcAt ihm, damit Zeitfenster und Aufnahme zusammenbleiben.
  constructor({ rate = 12000, capacitySec = ringKapazitaetSec(), versatz = () => 0 } = {}) {
    this.rate = rate;
    this.ring = new RingBuffer(Math.round(rate * capacitySec));
    this.startedAtMs = null; // Zeit von Index 0 im Rahmen der App-Uhr zum Zeitpunkt des Starts
    this.versatz = versatz;
    this.versatzBeiStart = 0;
  }

  // Setzt die Zeit des ersten Abtastwerts und merkt sich den Ausgleich, der dabei galt
  starte(startedAtMs) {
    this.startedAtMs = startedAtMs;
    this.versatzBeiStart = this.versatz();
  }

  push(block) {
    this.ring.push(block);
  }

  // Korrigiert den Start. Der Wert gilt im Rahmen der App-Uhr zum Zeitpunkt des Starts (ohne späteren Ausgleich)
  korrigiereStart(startedAtMs) {
    this.startedAtMs = startedAtMs;
  }

  // Dauer der bisher aufgenommenen Werte in Sekunden
  get aufgenommenSec() {
    return this.ring.total / this.rate;
  }

  // Ändert sich der Ausgleich der App-Uhr nach dem Start, rechnet man eine Ankunftszeit von heute auf den Rahmen des Starts zurück
  imStartRahmen(jetztMs) {
    return jetztMs - this.#nachgang();
  }

  // Aufnahme verwerfen, z. B. wenn das Mikrofon aus- und wieder eingeschaltet wird: die Lücke dazwischen
  // würde sonst die Zuordnung von Index zu UTC verschieben
  zuruecksetzen() {
    this.ring = new RingBuffer(this.ring.capacity);
    this.startedAtMs = null;
    this.versatzBeiStart = 0;
  }

  // Änderung des Ausgleichs seit dem Start der Aufnahme
  #nachgang() { return this.versatz() - this.versatzBeiStart; }

  indexAt(utcMs) {
    return Math.round(((utcMs - this.startedAtMs - this.#nachgang()) / 1000) * this.rate);
  }

  utcAt(index) {
    return this.startedAtMs + (index / this.rate) * 1000 + this.#nachgang();
  }

  // Ausschnitt für ein Zeitfenster: ab slotStartMs minus Vorlauf, dauerSec + Vorlauf lang.
  // null, solange er nicht vollständig aufgenommen ist oder schon überschrieben wurde.
  slice(slotStartMs, dauerSec, vorlaufSec = 0) {
    if (this.startedAtMs === null) return null;
    const vorlauf = Math.round(vorlaufSec * this.rate);
    const start = this.indexAt(slotStartMs) - vorlauf;
    const laenge = Math.round(dauerSec * this.rate) + vorlauf;
    const samples = this.ring.read(start, laenge);
    return samples ? { samples, startIndex: start, leadSec: vorlauf / this.rate } : null;
  }

  // Ausschnitt für den Decoder: von slotStartMs - vorlaufSec bis untilMs. Was noch nicht aufgenommen oder schon
  // überschrieben ist, wird mit Stille gefüllt, damit der Zeitbezug stimmt (Index 0 liegt immer bei
  // slotStartMs - vorlaufSec). availableSec: wie viel vom Fenster (ab slotStartMs) wirklich da ist.
  // null, wenn nichts davon vorhanden ist.
  sliceWindow(slotStartMs, untilMs, vorlaufSec = 0) {
    if (this.startedAtMs === null) return null;
    const von = this.indexAt(slotStartMs) - Math.round(vorlaufSec * this.rate);
    const bis = this.indexAt(untilMs);
    if (bis <= von) return null;
    const lesenVon = Math.max(von, this.ring.oldest);
    const lesenBis = Math.min(bis, this.ring.total);
    if (lesenBis <= lesenVon) return null;
    const samples = new Float32Array(bis - von);
    const teil = this.ring.read(lesenVon, lesenBis - lesenVon);
    samples.set(teil, lesenVon - von);
    return {
      samples,
      startIndex: von,
      leadSec: vorlaufSec,
      availableSec: (lesenBis - Math.max(lesenVon, this.indexAt(slotStartMs))) / this.rate,
    };
  }
}
