// Wasserfall auf einem Canvas: Farbskala, Achsen und Marken aus dem Profil. Die reinen Rechenteile
// (Farbskala, Frequenz <-> Bildpunkt, Bandmarke) sind getrennt und werden getestet.

import { rowToPixels } from './spectrum.js';

// Viridis-ähnlich: wahrnehmungsgleich, für Farbfehlsichtigkeit lesbar, in hellem und dunklem Theme gut
const STUETZPUNKTE = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37],
];
const FARBEN = Array.from({ length: 256 }, (_, i) => {
  const t = (i / 255) * (STUETZPUNKTE.length - 1);
  const a = Math.min(STUETZPUNKTE.length - 2, Math.floor(t));
  const f = t - a;
  return STUETZPUNKTE[a].map((v, k) => Math.round(v + (STUETZPUNKTE[a + 1][k] - v) * f));
});

export function colorFor(db, dbMin, dbMax) {
  const t = Math.min(1, Math.max(0, (db - dbMin) / (dbMax - dbMin)));
  return FARBEN[Math.round(t * 255)];
}

export function freqToX(f, ansicht) {
  return ((f - ansicht.fMin) / (ansicht.fMax - ansicht.fMin)) * ansicht.breite;
}

export function xToFreq(x, ansicht) {
  return ansicht.fMin + (x / ansicht.breite) * (ansicht.fMax - ansicht.fMin);
}

// Frequenzband des eigenen Sendesignals: Ton 0 bis Ton 7 samt einem Tonabstand
export function bandMarker(profil, ansicht) {
  const von = profil.f0;
  const bis = profil.f0 + 8 * profil.toneSpacing;
  return { von, bis, xVon: freqToX(von, ansicht), xBis: freqToX(bis, ansicht) };
}

export class Waterfall {
  // canvas: Wasserfall, overlay: Canvas darüber für Marken (gleiche Größe)
  constructor(canvas, overlay, { fMin = 500, fMax = 3500, dbMin = -100, dbMax = -50, onTap = null } = {}) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.octx = overlay.getContext('2d');
    this.fMin = fMin;
    this.fMax = fMax;
    this.dbMin = dbMin;
    this.dbMax = dbMax;
    this.boden = null; // geglätteter Rauschboden für die Automatik
    this.automatik = true;
    this.marken = { tx: null, rx: null, profil: null };
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (onTap) {
      // Frequenzwahl nur per Doppeltipp, damit Wischen zum Scrollen die Frequenz nicht verstellt
      let letzter = null;
      let start = null;
      overlay.addEventListener('pointerdown', (ev) => { start = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }; });
      overlay.addEventListener('pointercancel', () => { start = null; letzter = null; });
      overlay.addEventListener('pointerup', (ev) => {
        if (!start) return;
        const kurz = ev.timeStamp - start.t < 400 && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 10;
        start = null;
        if (!kurz) { letzter = null; return; }
        const nah = letzter && ev.timeStamp - letzter.t < 400 && Math.hypot(ev.clientX - letzter.x, ev.clientY - letzter.y) < 40;
        if (!nah) { letzter = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }; return; }
        letzter = null;
        const r = overlay.getBoundingClientRect();
        const f = xToFreq(((ev.clientX - r.left) / r.width) * overlay.width, this.ansicht());
        onTap(Math.min(this.fMax, Math.max(this.fMin, f)), ev);
      });
    }
  }

  ansicht() {
    return { fMin: this.fMin, fMax: this.fMax, breite: this.canvas.width };
  }

  // Neue Zeile oben einfügen, ältere rutschen nach unten. slotStart zeichnet eine Trennlinie.
  addRow(zeileDb, binHz, { slotStart = false } = {}) {
    const { width: w, height: h } = this.canvas;
    const pixel = rowToPixels(zeileDb, binHz, this.fMin, this.fMax, w);
    if (this.automatik) this.passeBereichAn(pixel);
    this.ctx.drawImage(this.canvas, 0, 0, w, h - 1, 0, 1, w, h - 1);
    const bild = this.ctx.createImageData(w, 1);
    for (let x = 0; x < w; x++) {
      const c = slotStart ? [255, 255, 255] : colorFor(pixel[x], this.dbMin, this.dbMax);
      bild.data[4 * x] = c[0]; bild.data[4 * x + 1] = c[1]; bild.data[4 * x + 2] = c[2]; bild.data[4 * x + 3] = 255;
    }
    this.ctx.putImageData(bild, 0, 0);
  }

  // Rauschboden verfolgen: Median der Zeile, langsam geglättet; Skala reicht 45 dB darüber
  passeBereichAn(pixel) {
    const sortiert = Float32Array.from(pixel).sort();
    // nie unter -110 dBFS: bei digitaler Stille (Zeilen mit -240 dB) würde die Skala sonst jedes Rauschen sättigen
    const median = Math.max(-110, sortiert[Math.floor(sortiert.length / 2)]);
    this.boden = this.boden === null ? median : this.boden * 0.98 + median * 0.02;
    this.dbMin = this.boden + 3;
    this.dbMax = this.boden + 48;
  }

  setMarkers(marken) {
    Object.assign(this.marken, marken);
    this.zeichneMarken();
  }

  zeichneMarken() {
    const { width: w, height: h } = this.overlay;
    const g = this.octx;
    g.clearRect(0, 0, w, h);
    const a = this.ansicht();
    g.font = '14px Roboto Mono, monospace';
    g.textBaseline = 'top';
    const m = this.marken;
    if (m.tx !== null && m.profil) {
      const band = bandMarker({ ...m.profil, f0: m.tx }, a);
      g.fillStyle = 'rgba(255, 60, 60, 0.18)';
      g.fillRect(band.xVon, 0, band.xBis - band.xVon, h);
      g.strokeStyle = '#ff3c3c';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(band.xVon, 0); g.lineTo(band.xVon, h); g.stroke();
      g.fillStyle = '#ff5c5c';
      g.fillText(`Tx ${Math.round(m.tx)} Hz`, Math.min(band.xVon + 4, w - 110), 4);
    }
    if (m.rx !== null) {
      const x = freqToX(m.rx, a);
      g.strokeStyle = '#4fd8ff';
      g.setLineDash([6, 4]);
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#4fd8ff';
      g.fillText(`Rx ${Math.round(m.rx)} Hz`, Math.min(x + 4, w - 110), 22);
    }
    // Frequenzachse unten
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.lineWidth = 1;
    g.textBaseline = 'bottom';
    const schritt = this.fMax - this.fMin > 2000 ? 500 : 250;
    for (let f = Math.ceil(this.fMin / schritt) * schritt; f <= this.fMax; f += schritt) {
      const x = freqToX(f, a);
      g.beginPath(); g.moveTo(x, h - 16); g.lineTo(x, h); g.stroke();
      g.fillText(String(f), Math.min(x + 3, w - 40), h - 2);
    }
  }
}
