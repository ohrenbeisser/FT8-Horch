// Decoder für ein Signal bei bekannter Zeit und Frequenz: Töne messen, LLR bilden, Belief Propagation,
// CRC prüfen, Nachricht entpacken. Alle Zwischenergebnisse bleiben im Ergebnis, damit die Lehransicht
// sie anzeigen kann. decodeAll sucht zuerst Signale (sync.js) und decodiert jeden Kandidaten.

import { symbolPowers, llrFromPowers } from './demod.js';
import { bpDecode } from './ldpc.js';
import { crc14 } from './crc14.js';
import { bitsToInt } from './bits.js';
import { unpackMessage, MessageError } from './pack77.js';
import { findCandidates, refineCandidate, estimateSnr } from './sync.js';
import { toneSequence } from './symbols.js';
import { SAMPLE_RATE } from './profile.js';

// samples: 12-kHz-Aufnahme, startSec: Beginn des ersten Symbols in den samples
export function decodeSignal(samples, profil, { startSec, f0 = profil.f0, maxIterations = 25, fenster = 'rect' } = {}) {
  if (!Number.isFinite(startSec)) throw new RangeError('startSec fehlt');
  if (samples.length < profil.symbolSamples) throw new RangeError('Aufnahme kürzer als ein Symbol');

  const powers = symbolPowers(samples, profil, { startSec, f0, fenster });
  const llr = llrFromPowers(powers);
  const ergebnis = {
    ok: false, text: null, message: null, reason: null, startSec, f0, fenster, powers, llr,
    bp: null, bits174: null, crc: { extracted: null, computed: null, ok: false },
  };

  if (llr.every((v) => v === 0)) {
    ergebnis.reason = 'leer';
    ergebnis.bp = { bits: null, errors: null, iterations: 0, history: [] };
    return ergebnis;
  }

  const bp = bpDecode(llr, maxIterations);
  ergebnis.bp = bp;
  ergebnis.bits174 = bp.bits;
  if (bp.errors > 0) {
    ergebnis.reason = 'ldpc';
    return ergebnis;
  }

  const bits77 = bp.bits.slice(0, 77);
  ergebnis.crc.extracted = bitsToInt(bp.bits.slice(77, 91));
  ergebnis.crc.computed = crc14([...bits77, 0, 0, 0, 0, 0]);
  ergebnis.crc.ok = ergebnis.crc.extracted === ergebnis.crc.computed;
  if (!ergebnis.crc.ok) {
    ergebnis.reason = 'crc';
    return ergebnis;
  }

  try {
    ergebnis.message = unpackMessage(bits77);
    ergebnis.text = ergebnis.message.text;
    ergebnis.ok = true;
  } catch (e) {
    if (!(e instanceof MessageError)) throw e;
    ergebnis.reason = e.code; // gültiger Rahmen, aber ein Nachrichtentyp außerhalb des Umfangs
  }
  return ergebnis;
}

// Sucht alle Signale in einer Aufnahme und decodiert sie. opt wie bei findCandidates (Zeit- und
// Frequenzbereich, maxCandidates). Rückgabe: signals (nach Frequenz sortiert), unsupported (gültige Signale
// mit Nachrichtentyp außerhalb des Umfangs), Zahl der Kandidaten und Versuche.
export function decodeAll(samples, profil, opt = {}) {
  const kandidaten = findCandidates(samples, profil, opt);
  const signals = [];
  const nichtUnterstuetzt = []; // CRC stimmt, aber der Nachrichtentyp liegt außerhalb des Umfangs
  const fensterListe = opt.fenster === 'rect' ? ['rect'] : opt.fenster === 'hann2' ? ['hann2'] : ['hann2', 'rect'];
  let versuche = 0;
  for (const k of kandidaten) {
    const fein = refineCandidate(samples, profil, k);
    // Versuche: Feinposition, danach Grobposition (der Feinabgleich kann sich bei überlagerten Signalen
    // verlaufen); je Position erst das Hann-Fenster (belegtes Band), dann das Rechteckfenster (Rauschen)
    const positionen = [{ startSec: fein.startSec, f0: fein.f0 }, { startSec: k.startSec, f0: k.f0 }];
    let r = null;
    for (const pos of positionen) {
      for (const fenster of fensterListe) {
        r = decodeSignal(samples, profil, { ...pos, fenster });
        versuche++;
        if (r.ok || r.crc.ok) break; // decodiert, oder gültiger Rahmen mit unbekanntem Typ
      }
      if (r.ok || r.crc.ok) break;
    }
    if (!r.ok) {
      if (r.crc.ok && !nichtUnterstuetzt.some((u) => Math.abs(u.f0 - r.f0) < 4 * profil.toneSpacing
        && Math.abs(u.startSec - r.startSec) < 4 * profil.symbolSec)) {
        nichtUnterstuetzt.push({ reason: r.reason, startSec: r.startSec, f0: r.f0, bits77: r.bp.bits.slice(0, 77) });
      }
      continue;
    }
    const doppelt = signals.some((s) => s.text === r.text && Math.abs(s.f0 - r.f0) < 4 * profil.toneSpacing
      && Math.abs(s.startSec - r.startSec) < 4 * profil.symbolSec);
    if (doppelt) continue;
    const tones = toneSequence(r.bits174);
    signals.push({
      text: r.text,
      message: r.message,
      startSec: r.startSec,
      dtSec: r.startSec - (opt.leadSec ?? 0) - profil.startOffsetSec,
      f0: r.f0,
      snrDb: estimateSnr(r.powers, tones, profil),
      score: k.score,
      result: r,
    });
  }
  signals.sort((a, b) => a.f0 - b.f0);
  return { signals, unsupported: nichtUnterstuetzt, candidates: kandidaten.length, attempts: versuche };
}
