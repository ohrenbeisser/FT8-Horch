// Pegeltest: Auswertung von Stille- und Tonaufnahme. Alle Pegel in dBFS (1,0 = Vollaussteuerung).
// Der Rauschabstand bezieht sich wie bei FT8 auf 2500 Hz Bandbreite.

export const BODEN_DB = -120;
const SNR_MINDEST_DB = 30; // darunter ist das Signal für FT8 unnötig schwach (S1 auf den Handys: 41 bis 56 dB)
const TON_MINDEST_DB = 10; // so viel muss der Ton über dem Rauschen bei derselben Frequenz liegen
const SPITZE_LAUT_DB = -6;
const SPITZE_GRENZE_DB = -1;

const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : BODEN_DB);

export function analysiere(x) {
  let spitze = 0, summe = 0, clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > spitze) spitze = v;
    if (v >= 0.999) clipped++;
    summe += x[i] * x[i];
  }
  return { peakDb: db(spitze), rmsDb: db(Math.sqrt(summe / Math.max(1, x.length))), clippedAnzahl: clipped };
}

// Amplitude (dBFS) einer Sinusschwingung der Frequenz f, mit Hann-Fenster gegen Lecken
export function tonPegel(x, rate, f) {
  const n = x.length;
  let re = 0, im = 0, w = 0;
  const dw = (2 * Math.PI * f) / rate;
  for (let i = 0; i < n; i++) {
    const fenster = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re += fenster * x[i] * Math.cos(dw * i);
    im -= fenster * x[i] * Math.sin(dw * i);
    w += fenster;
  }
  return db((2 * Math.hypot(re, im)) / w);
}

// Rauschleistung (linear) in 2500 Hz, aus der Gesamtleistung einer Aufnahme ohne Signal (ohne Gleichanteil)
export function rauschenIn2500(x, rate) {
  let mittel = 0;
  for (let i = 0; i < x.length; i++) mittel += x[i];
  mittel /= x.length;
  let p = 0;
  for (let i = 0; i < x.length; i++) p += (x[i] - mittel) ** 2;
  return (p / x.length) * (2500 / (rate / 2));
}

export function erzeugeTestton({ rate = 12000, f = 1500, dauerSec = 3, amp = 0.5, rampeSec = 0.05 } = {}) {
  const n = Math.round(rate * dauerSec);
  const rampe = Math.round(rate * rampeSec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const huelle = Math.min(1, i / rampe, (n - 1 - i) / rampe);
    x[i] = amp * Math.sin((2 * Math.PI * f * i) / rate) * (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, huelle)));
  }
  return x;
}

// uebersteuert | laut | zu_leise | kein_ton | gut
export function bewerte({ peakDb, clippedAnzahl, snr2500Db, tonGehoert }) {
  if (!tonGehoert) return 'kein_ton';
  if (clippedAnzahl > 0 || peakDb > SPITZE_GRENZE_DB) return 'uebersteuert';
  if (snr2500Db < SNR_MINDEST_DB) return 'zu_leise';
  if (peakDb > SPITZE_LAUT_DB) return 'laut';
  return 'gut';
}

export function wertePegeltestAus({ stille, ton, rate, f }) {
  const s = analysiere(stille);
  const t = analysiere(ton);
  const tonDb = tonPegel(ton, rate, f);
  const stilleTonDb = tonPegel(stille, rate, f);
  const tonGehoert = tonDb - stilleTonDb >= TON_MINDEST_DB;
  const snr2500Db = 10 * Math.log10(((10 ** (tonDb / 20)) ** 2 / 2) / rauschenIn2500(stille, rate));
  return {
    rauschRmsDb: s.rmsDb, tonDb, peakDb: t.peakDb, clippedAnzahl: t.clippedAnzahl, snr2500Db, tonGehoert,
    urteil: bewerte({ peakDb: t.peakDb, clippedAnzahl: t.clippedAnzahl, snr2500Db, tonGehoert }),
  };
}
