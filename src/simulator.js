// Simulator: erzeugt ein Signal im eigenen Profil, mischt Zeit- und Frequenzversatz, Taktfehler und Rauschen zu
// und lässt den echten Decoder darüber laufen. Zeigt, bis zu welchem Rauschabstand ein Profil noch geht.
// Der Rauschabstand bezieht sich wie bei FT8 auf 2500 Hz Bandbreite.

import { encodeMessage } from './encoder.js';
import { synthesizeGfsk } from './gfsk.js';
import { decodeAll } from './decoder.js';
import { createProfile, SAMPLE_RATE } from './profile.js';
import { mischeRauschen } from './rauschen.js';
import { kompaktiere } from './empfang.js';

// Takt des Senders weicht um ppm ab: y[i] = x[i * (1 + ppm/1e6)], lineare Zwischenwerte, gleiche Länge
export function taktfehler(x, ppm) {
  const y = new Float32Array(x.length);
  const f = 1 + ppm * 1e-6;
  for (let i = 0; i < y.length; i++) {
    const q = i * f;
    const k = Math.floor(q);
    if (k + 1 >= x.length) { if (k < x.length) y[i] = x[k]; continue; }
    const a = q - k;
    y[i] = x[k] * (1 - a) + x[k + 1] * a;
  }
  return y;
}

export function simuliereVersuch({ text, kt = 1, kf = 1, f0 = 1500, snrDb, dtSec = 0, freqVersatzHz = 0, taktPpm = 0, seed = 1 }) {
  if (!text || !text.trim()) throw new Error('Nachricht fehlt');
  const { message, tones } = encodeMessage(text.trim());
  const empfaenger = createProfile({ kt, kf, f0 });
  const sender = createProfile({ kt, kf, f0: f0 + freqVersatzHz });
  const signal = taktPpm ? taktfehler(synthesizeGfsk(tones, sender), taktPpm) : synthesizeGfsk(tones, sender);
  const fenster = new Float32Array(Math.round(empfaenger.slotSec * SAMPLE_RATE));
  const start = empfaenger.startOffsetSamples + Math.round(dtSec * SAMPLE_RATE);
  for (let i = 0; i < signal.length; i++) {
    const k = start + i;
    if (k >= 0 && k < fenster.length) fenster[k] += signal[i];
  }
  const roh = mischeRauschen(fenster, snrDb, { seed, signalStart: Math.max(0, start), signalEnde: Math.min(fenster.length, start + signal.length) });
  const t0 = performance.now();
  const r = decodeAll(roh, empfaenger);
  const ms = performance.now() - t0;
  const treffer = r.signals.find((s) => s.text === message.text) ?? null;
  const fremd = r.signals.find((s) => s !== treffer) ?? null;
  return {
    ok: !!treffer,
    text: (treffer ?? fremd)?.text ?? null,
    falsch: !treffer && r.signals.length > 0, // etwas anderes als gesendet wurde "decodiert"
    dtSec: treffer?.dtSec ?? null,
    f0: treffer?.f0 ?? null,
    snrGeschaetztDb: treffer?.snrDb ?? null,
    zw: treffer ? kompaktiere(treffer, empfaenger) : null, // Zwischenwerte für den Codierungs-Tab
    signale: r.signals.length,
    ms,
  };
}

// Rauschabstand, bei dem die Erfolgsrate die 50 % kreuzt (lineare Zwischenrechnung, von oben nach unten).
// null, wenn die Reihe die 50 % nie kreuzt.
export function schwelle50(punkte) {
  const p = [...punkte].sort((a, b) => b.snrDb - a.snrDb);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if (a.rate >= 0.5 && b.rate < 0.5) return a.rate === b.rate ? a.snrDb : a.snrDb + ((a.rate - 0.5) / (a.rate - b.rate)) * (b.snrDb - a.snrDb);
  }
  return null;
}

// Sinnvoller Messbereich je Zeitfaktor: um die erwartete Schwelle (E5b: −19,6 / −22,4 / −25,0 / −27,3 dB)
export function standardBereich(kt) {
  const schwelle = -19.6 - 2.6 * Math.log2(kt);
  return { vonDb: Math.round(schwelle + 6), bisDb: Math.round(schwelle - 6), schrittDb: 2 };
}

export const snrListe = ({ vonDb, bisDb, schrittDb }) => {
  const liste = [];
  for (let s = vonDb; s >= bisDb - 1e-9; s -= schrittDb) liste.push(Math.round(s * 100) / 100);
  return liste;
};

// Reihe: je Rauschabstand `versuche` Versuche mit wechselndem Rauschen. versuch(params) liefert ein Versprechen
// (im Browser über den Worker). Rückgabe: je Rauschabstand { snrDb, n, ok, rate, falsch, msMittel }.
export async function laufeReihe({ basis, snrListe: liste, versuche, versuch, beiFortschritt = () => {}, abgebrochen = () => false }) {
  const ergebnis = [];
  const gesamt = liste.length * versuche;
  let fertig = 0;
  let msSumme = 0;
  for (const snrDb of liste) {
    const e = { snrDb, n: 0, ok: 0, falsch: 0, msMittel: 0, rate: 0 };
    let ms = 0;
    for (let i = 0; i < versuche; i++) {
      if (abgebrochen()) return ergebnis.concat(e.n ? [finish(e, ms)] : []);
      const r = await versuch({ ...basis, snrDb, seed: 1000 + fertig });
      e.n++;
      if (r.ok) e.ok++;
      if (r.falsch) e.falsch++;
      ms += r.ms;
      msSumme += r.ms;
      fertig++;
      beiFortschritt({ fertig, gesamt, snrDb, msProVersuch: msSumme / fertig });
    }
    ergebnis.push(finish(e, ms));
  }
  return ergebnis;
}

function finish(e, ms) {
  return { ...e, rate: e.ok / e.n, msMittel: ms / e.n };
}
