// Signalprofil: Zeitfaktor kt, Tonabstandfaktor kf und Offset f0.
//
// Das Profil ist die einzige Stelle, an der Symboldauer, Tonabstand und Zeitfenster stehen.
// Encoder, Tonerzeugung, Wasserfall und Decoder leiten alle Werte daraus ab. Standard-FT8
// ist das Profil mit kt = 1 und kf = 1.

export const SAMPLE_RATE = 12000; // Abtastrate der internen Verarbeitung in Hz
export const KT_WERTE = [1, 2, 4, 8];
export const KF_WERTE = [1, 2, 4, 8, 16];

const SYMBOLDAUER_STANDARD = 0.16; // s
const TONABSTAND_STANDARD = 6.25; // Hz
const FENSTER_STANDARD = 15; // s
const STARTVERSATZ_STANDARD = 0.5; // s
const ANZAHL_SYMBOLE = 79;
const ANZAHL_TOENE = 8;

// Vorlauf der Aufnahme vor dem Fensterbeginn (Signale mit negativem DT), je Zeitfaktor
export const VORLAUF_JE_KT_SEC = 2.5;
const RING_RESERVE_SEC = 10;

// Länge des Aufnahmepuffers: das längste Fenster plus Vorlauf plus Reserve (der späte Durchgang beginnt kurz nach dem Fensterende)
export function ringKapazitaetSec() {
  const kt = Math.max(...KT_WERTE);
  return FENSTER_STANDARD * kt + VORLAUF_JE_KT_SEC * kt + RING_RESERVE_SEC;
}

const NYQUIST_GRENZE = 5500; // Hz, unterhalb der 6 kHz bei 12 kHz Abtastrate
const FUNK_GRENZE = 2700; // Hz, darüber beschneidet ein Funkgerät-Durchlass
const LAUTSPRECHER_UNTERGRENZE = 500; // Hz, darunter gibt ein Handylautsprecher kaum etwas ab

export function createProfile({ kt = 1, kf = 1, f0 = 1500 } = {}) {
  if (!KT_WERTE.includes(kt)) throw new RangeError(`kt muss 1, 2, 4 oder 8 sein, war ${kt}`);
  if (!KF_WERTE.includes(kf)) throw new RangeError(`kf muss 1, 2, 4, 8 oder 16 sein, war ${kf}`);
  if (typeof f0 !== 'number' || !Number.isFinite(f0)) throw new RangeError(`f0 muss eine Zahl sein, war ${f0}`);

  const symbolSec = SYMBOLDAUER_STANDARD * kt;
  const toneSpacing = TONABSTAND_STANDARD * kf;
  const startOffsetSec = STARTVERSATZ_STANDARD * kt;
  const profil = {
    kt,
    kf,
    f0,
    standard: kt === 1 && kf === 1,
    symbolSec,
    symbolSamples: Math.round(symbolSec * SAMPLE_RATE),
    toneSpacing,
    slotSec: FENSTER_STANDARD * kt,
    signalSec: ANZAHL_SYMBOLE * symbolSec,
    startOffsetSec,
    startOffsetSamples: Math.round(startOffsetSec * SAMPLE_RATE),
    bandwidth: ANZAHL_TOENE * toneSpacing,
    modIndex: kf * kt, // Δf · Tsym, ganzzahlig, damit die Töne orthogonal bleiben
    toneFrequency: (n) => f0 + n * toneSpacing,
  };
  return Object.freeze(profil);
}

// Gibt Fehler (Profil nicht nutzbar) und Warnungen (nutzbar, aber heikel) als Codes zurück.
// Die Oberfläche übersetzt die Codes.
export function checkProfile(profil) {
  const errors = [];
  const warnings = [];
  const oberster = profil.f0 + ANZAHL_TOENE * profil.toneSpacing;

  if (profil.f0 <= 0) errors.push('f0_zu_niedrig');
  if (oberster >= NYQUIST_GRENZE) errors.push('f0_zu_hoch');
  if (profil.f0 < LAUTSPRECHER_UNTERGRENZE) warnings.push('f0_niedrig');
  if (oberster > FUNK_GRENZE) warnings.push('oberhalb_funk');
  return { errors, warnings };
}
