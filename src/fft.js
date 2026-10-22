// Schnelle Fourier-Transformation (Radix-2, Länge ein Vielfaches von 2^k) für Wasserfall und Suche.
// Komplex, an Ort und Stelle. Reelle Eingaben: Imaginärteil auf null setzen.
// Geprüft gegen die direkte DFT (tests/fft.test.js).

export class Fft {
  constructor(n) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) throw new RangeError(`FFT-Länge muss eine Zweierpotenz sein, war ${n}`);
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.umkehr = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.umkehr[i] = r;
    }
  }

  forward(re, im) {
    const n = this.n;
    if (re.length !== n || im.length !== n) throw new RangeError(`Felder müssen ${n} Werte haben`);
    for (let i = 0; i < n; i++) {
      const j = this.umkehr[i];
      if (j > i) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let laenge = 2; laenge <= n; laenge <<= 1) {
      const halb = laenge >> 1;
      const schritt = n / laenge;
      for (let start = 0; start < n; start += laenge) {
        for (let k = 0; k < halb; k++) {
          const wr = this.cos[k * schritt];
          const wi = this.sin[k * schritt];
          const a = start + k;
          const b = a + halb;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// FFT für Längen mit den Primfaktoren 2, 3 und 5 (z. B. 3840 = 2^8 · 3 · 5, zwei Symbole bei 12 kHz).
// Rekursive Zerlegung mit direkten Teiltransformationen kleiner Länge. Komplex, an Ort und Stelle.
// Geprüft gegen die direkte DFT (tests/fft-mixed.test.js).
export class MixedFft {
  constructor(n) {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`FFT-Länge muss eine positive ganze Zahl sein, war ${n}`);
    this.n = n;
    this.faktoren = [];
    let rest = n;
    for (const p of [2, 3, 5]) while (rest % p === 0) { this.faktoren.push(p); rest /= p; }
    if (rest !== 1) throw new RangeError(`FFT-Länge ${n} hat Primfaktoren außer 2, 3 und 5`);
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n); // exp(-2 pi i k / n)
    }
    this.tmpRe = new Float64Array(n);
    this.tmpIm = new Float64Array(n);
    this.tr = new Float64Array(5);
    this.ti = new Float64Array(5);
  }

  forward(re, im) {
    if (re.length !== this.n || im.length !== this.n) throw new RangeError(`Felder müssen ${this.n} Werte haben`);
    this.#rekursion(re, im, 0, 1, this.tmpRe, this.tmpIm, 0, this.n, 0);
    re.set(this.tmpRe);
    im.set(this.tmpIm);
  }

  #rekursion(inRe, inIm, inOff, inSchritt, outRe, outIm, outOff, n, fi) {
    if (n === 1) {
      outRe[outOff] = inRe[inOff];
      outIm[outOff] = inIm[inOff];
      return;
    }
    const p = this.faktoren[fi];
    const m = n / p;
    for (let q = 0; q < p; q++) {
      this.#rekursion(inRe, inIm, inOff + q * inSchritt, inSchritt * p, outRe, outIm, outOff + q * m, m, fi + 1);
    }
    const N = this.n;
    const schritt = N / n;
    const tr = this.tr;
    const ti = this.ti;
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) {
        const idx = outOff + q * m + k;
        const w = (q * k * schritt) % N;
        tr[q] = outRe[idx] * this.cos[w] - outIm[idx] * this.sin[w];
        ti[q] = outRe[idx] * this.sin[w] + outIm[idx] * this.cos[w];
      }
      for (let r = 0; r < p; r++) {
        let sr = 0;
        let si = 0;
        for (let q = 0; q < p; q++) {
          const w = ((N / p) * ((q * r) % p)) % N;
          sr += tr[q] * this.cos[w] - ti[q] * this.sin[w];
          si += tr[q] * this.sin[w] + ti[q] * this.cos[w];
        }
        outRe[outOff + r * m + k] = sr;
        outIm[outOff + r * m + k] = si;
      }
    }
  }
}
