// Steuerung einer Station: verbindet Zeitraster, Aufnahme, Decoder, QSO-Logik und Ausgabe.
//
// Zeitplan je Fenster (Standardprofil, andere Fenster skalieren mit kt):
//   0,5 s         eigenes Signal beginnt (wenn gesendet wird)
//   13,74 s       früher Decodierdurchgang: alle Signale mit DT bis rund +0,6 s sind zu Ende. Daraus entsteht die
//                 Antwort für das nächste Fenster.
//   15,05 s       Durchgang am Fensterende: holt Signale mit größerem Zeitversatz nach (Bandübersicht)
//   -0,4 s        Entscheidung, was im nächsten Sendefenster gesendet wird (txLeadSec vor dem Fensterbeginn).
//                 Läuft noch der frühe Durchgang, wartet die Entscheidung darauf, höchstens maxLateSec in das
//                 Fenster hinein. Dann beginnt die Wiedergabe verspätet (audio-out.js überspringt den Anfang).
// Im eigenen Sendefenster wird nicht decodiert.

import { slotInfo, nextSlotStart } from './clock.js';
import { createProfile, SAMPLE_RATE, VORLAUF_JE_KT_SEC } from './profile.js';

const DEDUP_TOENE = 4; // gleiche Nachricht in so vielen Tonabständen Entfernung gilt als dasselbe Signal (wie in decoder.js)
// Früher Durchgang bei kt >= 2: nur die besten Kandidaten prüfen. Fehlversuche kosten dort die meiste Zeit (docs/messung_decodezeit_2026-11-08.md),
// und der späte Durchgang holt den Rest nach. Bei kt = 1 bleibt es bei der Vorgabe des Decoders.
export const FRUEH_MAX_KANDIDATEN = 30;
const AUFBEWAHREN_FENSTER = 8; // so viele Fenster bleiben in den Merklisten

export class Station {
  // qso: Qso, profile: Signalprofil (kt, kf), clock: { now() }, recorder: { sliceWindow(startMs, untilMs, leadSec) },
  // decode(samples, profile, { leadSec }) -> Promise<{ signals, unsupported }>, encode(text, profile) -> Wellenform,
  // play(samples, rate, startUtcMs) -> Promise<{ stop(), ended }>, onEvent(ereignis)
  constructor({ qso, profile, clock, recorder, decode, encode, play, onEvent = () => {}, txLeadSec = 0.4, maxLateSec = null }) {
    this.qso = qso;
    this.clock = clock;
    this.recorder = recorder;
    this.decodeFn = decode;
    this.encodeFn = encode;
    this.playFn = play;
    this.onEvent = onEvent;
    this.txLeadSec = txLeadSec;
    this.maxLateOption = maxLateSec; // null: eine Sekunde je Zeitfaktor (so viele Symbole darf der Anfang fehlen)
    this.txF0 = profile.f0;
    this.decoding = null;
    this.decodingPass = null; // Nummer des laufenden Durchgangs (0 früh, 1 Fensterende)
    this.current = null;
    this.ticking = false;

    const alt = qso.onChange;
    qso.onChange = (q) => {
      alt?.(q);
      this.onEvent({ type: 'qso', state: q.state, dxCall: q.dxCall, tx: q.tx, txParity: q.txParity });
    };
    this.setProfile(profile);
  }

  // Ändern sich nur die Frequenz (f0) oder gar nichts, bleibt der Zeitplan bestehen. Sonst würden Durchgänge und Sendeentscheidung
  // des laufenden Fensters wiederholt (doppelte Ereignisse, verspätete Sendung).
  setProfile(profile) {
    const alt = this.profile;
    this.profile = profile;
    if (alt && alt.kt === profile.kt && alt.kf === profile.kf) return;
    this.slotMs = profile.slotSec * 1000;
    this.maxLateSec = this.maxLateOption ?? profile.kt;
    this.leadSec = VORLAUF_JE_KT_SEC * profile.kt; // Vorlauf der Aufnahme vor dem Fensterbeginn (Signale mit negativem DT)
    // Durchgänge: früh (nach dem Ende eines Signals mit DT +0,6 · kt) und am Fensterende
    this.passes = [profile.startOffsetSec + profile.signalSec + 0.6 * profile.kt, profile.slotSec + 0.05];
    this.done = new Set(); // "Fenster:Durchgang" bereits gelaufen
    this.seen = new Map(); // Fenster -> bereits gemeldete Signale
    this.txDecided = new Set();
    this.txHistory = new Set(); // Fenster, in denen gesendet wurde
  }

  // Ein Fenster, in dem von außen gesendet wird (zum Beispiel vom Verbindungstest): dort wird nicht decodiert
  markiereSendefenster(index) {
    this.txHistory.add(index);
  }

  setTxF0(f0) {
    this.txF0 = f0;
  }

  // Entfernt Einträge zu Fenstern, die lange vorbei sind
  aufraeumen(index) {
    const grenze = index - AUFBEWAHREN_FENSTER;
    for (const k of this.done) if (Number(k.split(':')[0]) < grenze) this.done.delete(k);
    for (const k of this.txDecided) if (k < grenze) this.txDecided.delete(k);
    for (const k of this.txHistory) if (k < grenze) this.txHistory.delete(k);
  }

  startCq(parity = 'even') {
    this.qso.startCq(parity);
  }

  // Auf ein CQ antworten. entry: { de, grid, parity, snrDb, f0 }. Gesendet wird auf der Frequenz des Anrufers.
  answer(entry) {
    if (Number.isFinite(entry.f0)) this.txF0 = entry.f0;
    this.qso.answer(entry);
  }

  halt() {
    this.qso.halt();
    this.current?.handle?.stop();
  }

  // Wird etwa alle 100 ms aufgerufen
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const jetzt = this.clock.now();
      this.aufraeumen(slotInfo(jetzt, this.profile).index);
      this.#planeDecodierung(jetzt);
      await this.#sendeEntscheidung(jetzt);
    } catch (fehler) {
      this.onEvent({ type: 'error', error: fehler });
    } finally {
      this.ticking = false;
    }
  }

  #planeDecodierung(jetzt) {
    const s = slotInfo(jetzt, this.profile);
    for (const idx of [s.index - 1, s.index]) {
      const startMs = s.startMs + (idx - s.index) * this.slotMs;
      for (let k = 0; k < this.passes.length; k++) {
        const key = `${idx}:${k}`;
        if (this.done.has(key)) continue;
        if (jetzt < startMs + this.passes[k] * 1000) continue;
        if (this.decoding) return; // eine Decodierung zurzeit, der Durchgang kommt im nächsten Tick
        this.done.add(key);
        if (this.txHistory.has(idx)) continue; // eigenes Sendefenster
        this.decodingPass = k;
        this.decoding = this.#decodiere(idx, startMs, k, jetzt)
          .catch((fehler) => this.onEvent({ type: 'error', error: fehler }))
          .finally(() => { this.decoding = null; this.decodingPass = null; });
        return;
      }
    }
  }

  async #decodiere(idx, startMs, durchgang, jetzt) {
    const bis = Math.min(jetzt, startMs + this.slotMs);
    const fenster = this.recorder.sliceWindow(startMs, bis, this.leadSec);
    if (!fenster) return;
    const ergebnis = await this.decodeFn(fenster.samples, this.profile, {
      leadSec: fenster.leadSec, durchgang, ...(durchgang === 0 && this.profile.kt >= 2 ? { maxCandidates: FRUEH_MAX_KANDIDATEN } : {}),
    });

    const parity = idx % 2 === 0 ? 'even' : 'odd';
    const bekannt = this.seen.get(idx) ?? [];
    const neu = ergebnis.signals.filter((sig) => !bekannt.some((b) => b.text === sig.text && Math.abs(b.f0 - sig.f0) < DEDUP_TOENE * this.profile.toneSpacing));
    this.seen.set(idx, [...bekannt, ...neu]);
    this.onEvent({ type: 'decoded', slotIndex: idx, slotStartMs: startMs, parity, pass: durchgang, signals: neu, unsupported: ergebnis.unsupported ?? [] });
    this.qso.onDecoded(neu.map((sig) => ({ text: sig.text, snrDb: sig.snrDb, f0: sig.f0, parity })));
    // alte Einträge aufräumen
    for (const k of this.seen.keys()) if (k < idx - 4) this.seen.delete(k);
  }

  // Beginn des nächsten Sendefensters der QSO-Logik: das laufende Fenster, wenn es die richtige Lage hat und höchstens
  // maxLateSec alt ist, sonst das nächste mit dieser Lage (dann bis zu zwei Fensterlängen später)
  naechsterSendeStart(jetzt) {
    const { qso, profile } = this;
    const s = slotInfo(jetzt, profile);
    if (s.parity === qso.txParity && jetzt - s.startMs <= this.maxLateSec * 1000) return s.startMs;
    return nextSlotStart(jetzt, profile, qso.txParity, 0);
  }

  async #sendeEntscheidung(jetzt) {
    const { qso, profile } = this;
    if (!qso.active || !qso.txParity) return;
    const startMs = this.naechsterSendeStart(jetzt);
    const idx = slotInfo(startMs, profile).index;
    if (this.txDecided.has(idx)) return;
    if (jetzt < startMs - this.txLeadSec * 1000) return;
    // Auf den frühen Durchgang warten, denn sein Ergebnis kann die Nachricht ändern. Der späte Durchgang beginnt erst nach
    // dem Fensterbeginn und kann diese Entscheidung nicht mehr beeinflussen: Auf ihn zu warten schob die Sendung
    // über maxLateSec hinaus und damit um ein ganzes Fensterpaar (30 s) nach hinten.
    if (this.decoding && this.decodingPass === 0 && jetzt < startMs + this.maxLateSec * 1000) return;

    this.txDecided.add(idx);
    const nachricht = qso.nextTx();
    if (!nachricht) return;
    this.txHistory.add(idx);
    const sendeProfil = createProfile({ kt: profile.kt, kf: profile.kf, f0: this.txF0 });
    const wellenform = this.encodeFn(nachricht.text, sendeProfil);
    const handle = await this.playFn(wellenform, SAMPLE_RATE, startMs, this.maxLateSec + 0.5);
    this.current = { idx, handle };
    this.onEvent({ type: 'tx', text: nachricht.text, n: nachricht.n, slotIndex: idx, slotStartMs: startMs, f0: this.txF0, lateMs: Math.max(0, this.clock.now() - startMs) });
    handle?.ended?.then?.(() => this.onEvent({ type: 'txend', slotIndex: idx }));
  }
}
