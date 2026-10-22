// Laufzeitmessung: Ein Chirp wird über Lautsprecher und Mikrofon geschickt und in der Aufnahme wiedergefunden.
// Der Unterschied zwischen geplantem Sendezeitpunkt und Zeitpunkt in der Aufnahme ist das, was zwei Geräte
// später als DT sehen (Ausgabelatenz, Eingangslatenz, Schätzfehler der Aufnahmezeit, Schall: 3 ms je Meter).

const NCC_MINDEST = 0.2;

export function erzeugeChirp({ rate = 12000, f1 = 600, f2 = 2400, dauerSec = 0.3 } = {}) {
  const n = Math.round(rate * dauerSec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const phase = 2 * Math.PI * (f1 * t + ((f2 - f1) / (2 * dauerSec)) * t * t);
    x[i] = Math.sin(phase) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return x;
}

const halbiere = (x, von, bis) => {
  const n = Math.floor((bis - von) / 2);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = 0.5 * (x[von + 2 * i] + x[von + 2 * i + 1]);
  return y;
};

// Normierte Kreuzkorrelation an einem Index (volle Rate)
function ncc(x, c, start, energieC) {
  let dot = 0, e = 0;
  for (let j = 0; j < c.length; j++) { const v = x[start + j]; dot += v * c[j]; e += v * v; }
  return e > 0 ? dot / Math.sqrt(e * energieC) : 0;
}

// Sucht den Chirp im Bereich [von, bis) der Aufnahme. Ergebnis: Index des Chirp-Anfangs (mit Bruchteil) und
// Korrelation (0 bis 1), oder null, wenn nichts Eindeutiges gefunden wird.
export function findeChirp(x, chirp, { von = 0, bis = x.length } = {}) {
  bis = Math.min(bis, x.length);
  if (bis - von < chirp.length + 2) return null;
  // Grobsuche mit halber Rate
  const xd = halbiere(x, von, bis);
  const cd = halbiere(chirp, 0, chirp.length - (chirp.length % 2));
  let ec = 0;
  for (const v of cd) ec += v * v;
  const nd = xd.length - cd.length;
  if (nd <= 0) return null;
  const prefix = new Float64Array(xd.length + 1);
  for (let i = 0; i < xd.length; i++) prefix[i + 1] = prefix[i] + xd[i] * xd[i];
  let besteL = -1, besterWert = 0;
  for (let l = 0; l <= nd; l++) {
    let dot = 0;
    for (let j = 0; j < cd.length; j++) dot += cd[j] * xd[l + j];
    const e = prefix[l + cd.length] - prefix[l];
    const w = e > 0 ? dot / Math.sqrt(e * ec) : 0;
    if (w > besterWert) { besterWert = w; besteL = l; }
  }
  if (besteL < 0) return null;
  // Feinsuche mit voller Rate um das Maximum
  let energieC = 0;
  for (const v of chirp) energieC += v * v;
  const mitte = von + 2 * besteL;
  const werte = new Map();
  let bestI = -1, bestW = -1;
  for (let i = Math.max(von, mitte - 4); i <= Math.min(bis - chirp.length, mitte + 4); i++) {
    const w = ncc(x, chirp, i, energieC);
    werte.set(i, w);
    if (w > bestW) { bestW = w; bestI = i; }
  }
  if (bestI < 0 || bestW < NCC_MINDEST) return null;
  // Parabel durch drei Punkte für den Bruchteil eines Abtastwerts
  const a = werte.get(bestI - 1), b = bestW, c = werte.get(bestI + 1);
  let bruch = 0;
  if (a !== undefined && c !== undefined && a - 2 * b + c < 0) bruch = (0.5 * (a - c)) / (a - 2 * b + c);
  return { index: bestI + bruch, ncc: bestW };
}

export function statistik(werte) {
  const n = werte.length;
  if (!n) return { n: 0 };
  const s = [...werte].sort((a, b) => a - b);
  const mittel = werte.reduce((a, b) => a + b, 0) / n;
  const streuung = n > 1 ? Math.sqrt(werte.reduce((a, b) => a + (b - mittel) ** 2, 0) / (n - 1)) : 0;
  return { n, mittelMs: mittel, medianMs: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, streuungMs: streuung, minMs: s[0], maxMs: s[n - 1] };
}
