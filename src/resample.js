// Abtastratenwandlung auf 12 kHz (oder eine andere Zielrate) mit einem Polyphasen-FIR-Filter.
//
// Das Filter ist ein Kaiser-Fenster-Tiefpass mit 80 dB Sperrdämpfung. Bis 45 % der kleineren der
// beiden Raten läuft das Signal ohne Verlust durch (bei 12 kHz Ausgang: bis 5,4 kHz), ab 55 % wird
// es gesperrt. So faltet nichts in den Bereich der FT8-Töne zurück. Die Verarbeitung läuft
// blockweise, der Zustand bleibt zwischen den Aufrufen erhalten.

const SPERR_DB = 80;

const ggt = (a, b) => (b === 0 ? a : ggt(b, a % b));

// Modifizierte Bessel-Funktion nullter Ordnung (Reihe)
function besselI0(x) {
  let summe = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) ** 2;
    summe += term;
    if (term < 1e-12 * summe) break;
  }
  return summe;
}

export class Resampler {
  constructor(inRate, outRate = 12000) {
    if (!Number.isInteger(inRate) || inRate <= 0 || !Number.isInteger(outRate) || outRate <= 0) {
      throw new RangeError(`Abtastraten müssen ganze positive Zahlen sein (${inRate} -> ${outRate})`);
    }
    this.inRate = inRate;
    this.outRate = outRate;
    this.durchreichen = inRate === outRate;
    this.delaySec = 0;
    if (this.durchreichen) return;

    const g = ggt(inRate, outRate);
    const L = outRate / g; // Hochtasten
    const M = inRate / g; // Herunterteilen
    const entwurfsRate = inRate * L;
    const kleinere = Math.min(inRate, outRate);
    const uebergang = 0.1 * kleinere; // von 45 % bis 55 %
    const gesamt0 = (SPERR_DB - 8) / (2.285 * 2 * Math.PI * (uebergang / entwurfsRate));
    const T = Math.max(2, Math.ceil(gesamt0 / L)); // Koeffizienten je Phase
    const gesamt = T * L;
    const mitte = (gesamt - 1) / 2;
    const grenze = (0.5 * kleinere) / entwurfsRate; // Grenzfrequenz relativ zur Entwurfsrate
    const beta = 0.1102 * (SPERR_DB - 8.7);
    const nenner = besselI0(beta);

    const h = new Float64Array(gesamt);
    let summe = 0;
    for (let k = 0; k < gesamt; k++) {
      const x = k - mitte;
      const sinc = x === 0 ? 2 * grenze : Math.sin(2 * Math.PI * grenze * x) / (Math.PI * x);
      const r = x / mitte;
      const fenster = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / nenner;
      h[k] = sinc * fenster;
      summe += h[k];
    }
    for (let k = 0; k < gesamt; k++) h[k] *= L / summe; // Gleichanteil 1 nach dem Hochtasten

    this.L = L;
    this.M = M;
    this.T = T;
    this.phasen = Array.from({ length: L }, (_, ph) => Float64Array.from({ length: T }, (_, d) => h[ph + d * L]));
    this.delaySec = mitte / entwurfsRate;

    this.puffer = new Float64Array(0);
    this.pufferStart = 0; // absoluter Index von puffer[0]
    this.anzahl = 0; // bisher eingegangene Abtastwerte
    this.pos = 0; // Position des nächsten Ausgabewerts auf dem Entwurfsraster
  }

  // Nimmt einen Block entgegen und gibt die neu entstandenen Ausgabewerte zurück
  push(eingang) {
    if (this.durchreichen) return Float32Array.from(eingang);

    const alt = this.puffer;
    const neu = new Float64Array(alt.length + eingang.length);
    neu.set(alt);
    neu.set(eingang, alt.length);
    this.puffer = neu;
    this.anzahl += eingang.length;

    const { L, M, T } = this;
    const aus = [];
    for (;;) {
      const basis = Math.floor(this.pos / L);
      if (basis >= this.anzahl) break;
      const koeff = this.phasen[this.pos % L];
      let y = 0;
      for (let d = 0; d < T; d++) {
        const i = basis - d;
        if (i < 0) break;
        y += koeff[d] * this.puffer[i - this.pufferStart];
      }
      aus.push(y);
      this.pos += M;
    }

    // Verlauf kürzen: ab dem nächsten Ausgabewert werden nur noch T - 1 ältere Werte gebraucht
    const behalten = Math.max(this.pufferStart, Math.floor(this.pos / L) - (T - 1));
    if (behalten > this.pufferStart) {
      this.puffer = this.puffer.slice(behalten - this.pufferStart);
      this.pufferStart = behalten;
    }
    return Float32Array.from(aus);
  }
}
