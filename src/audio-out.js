// Ausgabe über Web Audio: Wellenform zu einem UTC-Zeitpunkt abspielen.
//
// Die Wellenform liegt als Float32Array mit 12 kHz vor (gfsk.js). Der Browser rechnet sie beim
// Abspielen auf die Rate des Geräts um. Die Lautstärke stellt der Nutzer am Handy ein, die App
// kann sie nicht setzen.

import { setzeAusgang } from './audiogeraete.js';

export const MAX_VERSPAETUNG_SEC = 1.5; // später als das nach dem Slotbeginn startet die App nicht mehr

// Plant den Start. startUtcMs ist der gewünschte Zeitpunkt, an dem der Ton hörbar sein soll.
// Die Ausgabelatenz wird vorgehalten, damit der Ton pünktlich im Lautsprecher ankommt.
export function planStart(jetztMs, startUtcMs, latenzSec, maxVerspaetungSec = MAX_VERSPAETUNG_SEC) {
  const bisStartSec = (startUtcMs - jetztMs) / 1000;
  const vorlauf = bisStartSec - latenzSec;
  if (bisStartSec < -maxVerspaetungSec) return { moeglich: false, grund: 'zu_spaet', vorlaufSec: 0 };
  // Der Ton braucht die Latenz bis zum Lautsprecher: Was davon nicht durch früheren Start auszugleichen ist, wird übersprungen
  return { moeglich: true, vorlaufSec: Math.max(0, vorlauf), verspaetungSec: Math.max(0, -vorlauf) };
}

export class AudioOut {
  #ctx = null;
  #sink = ''; // zuletzt eingestellter Lautsprecher

  // jetzt: die Uhr der App (ausgeglichen, siehe clock.js), nicht die rohe Systemzeit
  // zusatzMs: vom Nutzer eingetragene Latenz, die der Browser nicht kennt (zum Beispiel Bluetooth-Lautsprecher)
  // ausgangId: Kennung des gewählten Lautsprechers (leer = Standardgerät), wird bei jedem start() abgeglichen
  constructor({ jetzt = () => Date.now(), zusatzMs = () => 0, ausgangId = () => '' } = {}) {
    this.jetzt = jetzt;
    this.zusatzMs = zusatzMs;
    this.ausgangId = ausgangId;
  }

  // Muss aus einer Nutzeraktion (Tipp) aufgerufen werden, sonst startet der Browser den Ton nicht.
  async start() {
    this.#ctx ??= new AudioContext({ latencyHint: 'interactive' });
    const id = this.ausgangId() || '';
    if (id !== this.#sink && await setzeAusgang(this.#ctx, id)) this.#sink = id;
    if (this.#ctx.state !== 'running') await this.#ctx.resume();
    return this.#ctx;
  }

  // Zusatzlatenz des Nutzers in Sekunden (nie negativ)
  get zusatzSec() {
    return Math.max(0, Number(this.zusatzMs()) || 0) / 1000;
  }

  // Latenz bis zum Lautsprecher in Sekunden, einschließlich der Zusatzlatenz.
  // outputLatency gibt es nicht in jedem Browser.
  get latencySec() {
    const browser = this.#ctx ? (this.#ctx.baseLatency ?? 0) + (this.#ctx.outputLatency ?? 0) : 0;
    return browser + this.zusatzSec;
  }

  // Spielt samples ab. startUtcMs = null startet sofort. Gibt ein Handle mit stop() und dem
  // Versprechen ended zurück, das nach dem Ende (oder Stopp) erfüllt wird.
  async play(samples, sampleRate, startUtcMs = null, maxVerspaetungSec = MAX_VERSPAETUNG_SEC) {
    const ctx = await this.start();
    const plan = startUtcMs === null
      ? { moeglich: true, vorlaufSec: 0, verspaetungSec: 0 }
      : planStart(this.jetzt(), startUtcMs, this.latencySec, maxVerspaetungSec);
    if (!plan.moeglich) throw new Error(plan.grund);

    const puffer = ctx.createBuffer(1, samples.length, sampleRate);
    puffer.copyToChannel(samples, 0);
    const quelle = ctx.createBufferSource();
    quelle.buffer = puffer;
    quelle.connect(ctx.destination);

    const ended = new Promise((fertig) => { quelle.onended = fertig; });
    // Bei kleiner Verspätung beginnt die Wiedergabe sofort und überspringt den bereits verstrichenen Teil
    quelle.start(ctx.currentTime + plan.vorlaufSec, plan.verspaetungSec);
    return {
      ended,
      stop: () => { try { quelle.stop(); } catch { /* war schon beendet */ } },
      latencySec: this.latencySec,
    };
  }

  async close() {
    if (this.#ctx) await this.#ctx.close();
    this.#ctx = null;
    this.#sink = '';
  }
}
