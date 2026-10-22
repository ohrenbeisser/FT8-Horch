// Verbindungstest zwischen zwei Geräten (A und B), die nebeneinander liegen: A sendet in den geraden, B in den
// ungeraden Fenstern einen bekannten Kurztext, beide messen, wie sie den anderen hören (Rauschabstand, DT). Am Ende
// schickt jedes Gerät eine Zusammenfassung, damit jedes Gerät beide Richtungen kennt.
//
// Ablauf in Fenstern (R Runden): je Runde ein gerades Fenster für A und das folgende ungerade für B, danach ein Paar
// Pause (der letzte Empfang ist bis dahin ausgewertet) und ein Paar mit den Zusammenfassungen.
//
// Die Messung kommt aus den Decodierungen der laufenden Station (Ereignis „decoded“). Der Test decodiert nicht selbst.
//
// DT, das ein Empfänger misst: Abweichung der Uhr (Sender gegen Empfänger) plus Latenzen von Sender (Wiedergabe) und
// Empfänger (Aufnahme). Aus beiden Richtungen folgt:
//   Mittel   = (DT_ein + DT_aus) / 2  : Latenzen beider Geräte, die Uhren heben sich heraus
//   Uhrunterschied = (DT_ein − DT_aus) / 2 : Uhr dieses Geräts minus Uhr des anderen, einschließlich des Unterschieds der Latenzen
import { nextSlotStart, slotInfo } from './clock.js';

export const VORLAUF_START_SEC = 20; // so früh darf der Start liegen
export const MIN_RUNDEN = 2;
export const MAX_RUNDEN = 10;
export const GRENZE_RATE = 0.75; // darunter gilt die Richtung als zu schlecht
export const GRENZE_DT_SEC = 0.3; // darüber gilt DT als zu groß (der Decoder verträgt mehr, die Sendung verliert aber ihren Anfang)

const zwei = (n) => String(n).padStart(2, '0');
const vorz = (x, stellen, breite) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(stellen).padStart(breite, '0')}`;

// Text einer Runde: HORCH A 03
export const rundeText = (rolle, runde) => `HORCH ${rolle} ${zwei(runde)}`;

// Zusammenfassung: ZA08-12+0.2 (Gerät A hat 8 Nachrichten empfangen, Rauschabstand −12 dB, DT +0,2 s).
// Immer 11 Zeichen, damit sie als Freitext (13 Zeichen) passt. Werte außerhalb des Bereichs werden begrenzt.
export function endeText(rolle, { anzahl, snrDb, dtSec }) {
  const n = Math.max(0, Math.min(99, Math.round(anzahl)));
  const snr = Math.max(-99, Math.min(99, Math.round(snrDb)));
  const dt = Math.max(-9.9, Math.min(9.9, dtSec));
  return `Z${rolle}${zwei(n)}${vorz(snr, 0, 2)}${vorz(dt, 1, 3)}`;
}

// Text einer Nachricht lesen: { art: 'runde', rolle, runde } oder { art: 'ende', rolle, anzahl, snrDb, dtSec } oder null
export function leseTestText(text) {
  const t = String(text).trim().toUpperCase();
  let m = /^HORCH ([AB]) (\d{2})$/.exec(t);
  if (m) return { art: 'runde', rolle: m[1], runde: Number(m[2]) };
  m = /^Z([AB])(\d{2})([+-]\d{2})([+-]\d\.\d)$/.exec(t);
  if (m) return { art: 'ende', rolle: m[1], anzahl: Number(m[2]), snrDb: Number(m[3]), dtSec: Number(m[4]) };
  return null;
}

// Zeitplan: erstes gerades Fenster, das frühestens VORLAUF_START_SEC nach jetzt beginnt, dann je Fenster ein Eintrag
export function planeTest({ jetztMs, profil, runden }) {
  const startMs = nextSlotStart(jetztMs, profil, 'even', VORLAUF_START_SEC * 1000);
  const index0 = slotInfo(startMs, profil).index;
  const fenster = [];
  const eintrag = (k, rolle, art, runde) => fenster.push({ index: index0 + k, startMs: startMs + k * profil.slotSec * 1000, rolle, art, runde });
  for (let r = 1; r <= runden; r++) { eintrag(2 * (r - 1), 'A', 'runde', r); eintrag(2 * (r - 1) + 1, 'B', 'runde', r); }
  eintrag(2 * runden + 2, 'A', 'ende', 0);
  eintrag(2 * runden + 3, 'B', 'ende', 0);
  const endeMs = startMs + (2 * runden + 4) * profil.slotSec * 1000;
  return { startMs, endeMs, runden, fenster };
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Auswertung der Empfänge einer Richtung: empfangen = [{ runde, snrDb, dtSec, f0 }]
export function werteRichtungAus(empfangen, runden) {
  const n = empfangen.length;
  return {
    anzahl: n,
    von: runden,
    rate: runden ? n / runden : 0,
    snrDb: median(empfangen.map((e) => e.snrDb)),
    dtSec: median(empfangen.map((e) => e.dtSec)),
    dtStreuSec: n ? Math.max(...empfangen.map((e) => e.dtSec)) - Math.min(...empfangen.map((e) => e.dtSec)) : null,
    f0: median(empfangen.map((e) => e.f0)),
  };
}

// Beide Richtungen zusammen. ein: Auswertung der eigenen Empfänge, aus: Zusammenfassung der Gegenseite
// ({ anzahl, snrDb, dtSec }) oder null. Rückgabe enthält Kennzahlen und die Codes der Befunde.
export function kombiniere(ein, aus, runden) {
  const befunde = [];
  const e = { ...ein };
  if (ein.anzahl === 0) befunde.push('nichts_empfangen');
  else if (ein.rate < GRENZE_RATE) befunde.push('rate_ein');
  let ausAuswertung = null;
  let mittelSec = null;
  let uhrSec = null;
  if (aus) {
    ausAuswertung = { anzahl: aus.anzahl, von: runden, rate: runden ? aus.anzahl / runden : 0, snrDb: aus.anzahl ? aus.snrDb : null, dtSec: aus.anzahl ? aus.dtSec : null };
    if (aus.anzahl === 0) befunde.push('nichts_gehoert');
    else if (ausAuswertung.rate < GRENZE_RATE) befunde.push('rate_aus');
    if (ein.anzahl && aus.anzahl) {
      mittelSec = (ein.dtSec + aus.dtSec) / 2;
      uhrSec = (ein.dtSec - aus.dtSec) / 2;
      if (Math.abs(mittelSec) > GRENZE_DT_SEC) befunde.push('latenz_hoch');
      if (Math.abs(uhrSec) > GRENZE_DT_SEC) befunde.push('uhr_unterschied');
    }
  } else befunde.push('keine_zusammenfassung');
  if (befunde.length === 0) befunde.push('gut');
  return { ein: e, aus: ausAuswertung, mittelSec, uhrSec, befunde };
}

// Ergebnis als Text (zum Speichern)
export function ergebnisAlsText({ rolle, profil, plan, ein, aus, mittelSec, uhrSec, befunde, jetztMs }) {
  const z = (x, s = 1) => (x === null || x === undefined ? '–' : x.toFixed(s));
  const gegen = rolle === 'A' ? 'B' : 'A';
  return [
    `FT8-Horch Verbindungstest, ${new Date(jetztMs).toISOString().slice(0, 19)}Z`,
    `Dieses Gerät: ${rolle}, Profil kt=${profil.kt} kf=${profil.kf} f0=${Math.round(profil.f0)} Hz, ${plan.runden} Runden`,
    `Von ${gegen} empfangen: ${ein.anzahl}/${ein.von}, Rauschabstand ${z(ein.snrDb, 0)} dB, DT ${z(ein.dtSec, 2)} s (Streuung ${z(ein.dtStreuSec, 2)} s)`,
    aus ? `Von ${gegen} gehört (Meldung der Gegenseite): ${aus.anzahl}/${aus.von}, Rauschabstand ${z(aus.snrDb, 0)} dB, DT ${z(aus.dtSec, 2)} s` : 'Meldung der Gegenseite: keine empfangen',
    `Mittleres DT beider Richtungen: ${z(mittelSec, 2)} s`,
    `Uhr dieses Geräts gegenüber ${gegen}: ${z(uhrSec, 2)} s`,
    `Befund: ${befunde.join(', ')}`,
  ].join('\n');
}

// Ablauf auf einem Gerät. Die Teile sind eingesteckt, damit sich der Test ohne Browser prüfen lässt:
//   clock { now() }, encode(text, profil) -> Wellenform, play(samples, rate, startMs) -> Versprechen mit { stop(), ended },
//   onEvent(ereignis): plan, tx, rx, ende, fertig, abgebrochen
// beiDecodiert(e) bekommt die „decoded“-Ereignisse der Station, tick() wird etwa alle 100 ms gerufen.
export class Verbindungstest {
  constructor({ rolle, profile, clock, encode, play, onEvent = () => {}, sendefenster = () => {}, runden = 4, txLeadSec = 0.4, maxLateSec = null }) {
    if (rolle !== 'A' && rolle !== 'B') throw new RangeError('Rolle muss A oder B sein');
    if (!Number.isInteger(runden) || runden < MIN_RUNDEN || runden > MAX_RUNDEN) throw new RangeError(`Runden: ${MIN_RUNDEN} bis ${MAX_RUNDEN}`);
    Object.assign(this, { rolle, profile, clock, encodeFn: encode, playFn: play, onEvent, sendefenster, runden, txLeadSec });
    this.maxLateSec = maxLateSec ?? profile.kt;
    this.gegen = rolle === 'A' ? 'B' : 'A';
    this.zustand = 'idle';
    this.plan = null;
    this.empfangen = [];
    this.gegenEnde = null;
    this.entschieden = new Set();
    this.aktuell = null;
    this.ticking = false;
  }

  starte() {
    if (this.zustand === 'wartet' || this.zustand === 'laeuft') throw new Error('Test läuft schon');
    this.plan = planeTest({ jetztMs: this.clock.now(), profil: this.profile, runden: this.runden });
    this.zustand = 'wartet';
    this.empfangen = [];
    this.gegenEnde = null;
    this.entschieden = new Set();
    this.onEvent({ type: 'plan', plan: this.plan, rolle: this.rolle });
    return this.plan;
  }

  stop() {
    if (this.zustand !== 'wartet' && this.zustand !== 'laeuft') return;
    this.aktuell?.stop?.();
    this.zustand = 'abgebrochen';
    this.onEvent({ type: 'abgebrochen' });
  }

  get meinEmpfang() { return werteRichtungAus(this.empfangen, this.runden); }

  // „decoded“-Ereignis der Station: nur Nachrichten der Gegenseite aus den dafür geplanten Fenstern zählen
  beiDecodiert(e) {
    if (this.zustand !== 'wartet' && this.zustand !== 'laeuft') return;
    const f = this.plan.fenster.find((x) => x.index === e.slotIndex && x.rolle === this.gegen);
    if (!f) return;
    for (const s of e.signals) {
      const m = leseTestText(s.text);
      if (!m || m.rolle !== this.gegen || m.art !== f.art) continue;
      if (m.art === 'runde') {
        if (m.runde !== f.runde || this.empfangen.some((x) => x.runde === m.runde)) continue;
        const r = { runde: m.runde, snrDb: s.snrDb, dtSec: s.dtSec, f0: s.f0, slotIndex: e.slotIndex };
        this.empfangen.push(r);
        this.onEvent({ type: 'rx', ...r });
      } else if (!this.gegenEnde) {
        this.gegenEnde = { anzahl: m.anzahl, snrDb: m.snrDb, dtSec: m.dtSec };
        this.onEvent({ type: 'ende', ...this.gegenEnde });
      }
    }
  }

  // Ergebnis aus dem jetzigen Stand
  ergebnis(jetztMs = this.clock.now()) {
    const ein = this.meinEmpfang;
    const k = kombiniere(ein, this.gegenEnde, this.runden);
    return { rolle: this.rolle, profil: this.profile, plan: this.plan, jetztMs, ...k };
  }

  async tick() {
    if (this.ticking || (this.zustand !== 'wartet' && this.zustand !== 'laeuft')) return;
    this.ticking = true;
    try {
      const jetzt = this.clock.now();
      if (this.zustand === 'wartet' && jetzt >= this.plan.startMs) this.zustand = 'laeuft';
      for (const f of this.plan.fenster) {
        if (f.rolle !== this.rolle || this.entschieden.has(f.index)) continue;
        if (jetzt < f.startMs - this.txLeadSec * 1000) continue;
        this.entschieden.add(f.index);
        if (jetzt > f.startMs + this.maxLateSec * 1000) continue; // zu spät, dieses Fenster fällt aus
        await this.sende(f);
      }
      // Ende: nach dem letzten Fenster ist alles ausgewertet; die Gegenseite hat ihre Zusammenfassung dann gesendet
      if (jetzt >= this.plan.endeMs + 3000 || (this.gegenEnde && jetzt >= this.plan.endeMs - 1000)) {
        this.zustand = 'fertig';
        this.onEvent({ type: 'fertig', ergebnis: this.ergebnis(jetzt) });
      }
    } finally { this.ticking = false; }
  }

  async sende(f) {
    const text = f.art === 'runde' ? rundeText(this.rolle, f.runde) : endeText(this.rolle, this.meinEmpfang.anzahl ? this.meinEmpfang : { anzahl: 0, snrDb: 0, dtSec: 0 });
    const wellenform = this.encodeFn(text, this.profile);
    this.sendefenster(f.index);
    this.aktuell = await this.playFn(wellenform, 12000, f.startMs, this.maxLateSec + 0.5);
    this.onEvent({ type: 'tx', text, art: f.art, runde: f.runde, slotIndex: f.index, startMs: f.startMs, lateMs: Math.max(0, this.clock.now() - f.startMs) });
  }
}
