// Codierungs-Tab: die Kette von der Nachricht bis zu den 79 Tönen mit den echten Modulen des Senders.
// Karten (aufklappbar): Nachricht, 77 Bits, CRC-14, LDPC, Fehlerschutz zum Ausprobieren, Töne, Symbole, Signal.
import { baueKette, kippe, zufallsFehler, pruefeUndKorrigiere, vergleicheDecoder, haeufigkeit, BIT_ABSCHNITTE } from './src/kette.js';
import { baueEmpfang } from './src/empfang.js';
import { synthesizeGfsk, renderSlot } from './src/gfsk.js';
import { encodeWav } from './src/wav.js';
import { dateinameSignal } from './src/wavdatei.js';
import { herunterladen } from './src/herunterladen.js';
import { vorschauSpektrogramm } from './src/vorschau.js';
import { colorFor } from './src/waterfall.js';
import { GRAY, LDPC_M } from './src/constants.js';
import { SAMPLE_RATE } from './src/profile.js';
import { t, zahl } from './src/i18n.js';

const $ = (id) => document.getElementById(id);

function el(tag, klasse = '', text = null, kinder = []) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== null) e.textContent = text;
  for (const k of kinder) e.append(k);
  return e;
}

// Bits in Vierergruppen, damit sie sich lesen lassen
const gruppiert = (bits) => bits.join('').replace(/(.{4})(?=.)/g, '$1 ');

// Schlüssel: <prefix>.title, <prefix>.text und die Absätze <prefix>.more.1, .2, … bis zum ersten fehlenden
function karte(nr, prefix, offen = false) {
  const d = el('details', 'karte');
  d.open = offen;
  const s = el('summary', '', null, [el('span', 'nr', String(nr)), el('span', 'title-md', t(`${prefix}.title`))]);
  d.append(s, el('p', 'hint', t(`${prefix}.text`)));
  const absaetze = [];
  for (let i = 1; t(`${prefix}.more.${i}`) !== `${prefix}.more.${i}`; i++) absaetze.push(el('p', '', t(`${prefix}.more.${i}`)));
  if (absaetze.length) d.append(el('details', 'mehr', null, [el('summary', 'label-lg', t('cod.more')), ...absaetze]));
  const inhalt = el('div', 'karteninhalt');
  d.append(inhalt);
  return { d, inhalt };
}

const vorz = (x) => (Math.abs(x) < 0.005 ? '' : x > 0 ? '+' : '−');
const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const messZeile = (ziel, k, w) => ziel.append(el('div', 'messzeile', null, [el('span', '', k), el('span', 'mono', w)]));

// Felder der Nachricht als Chips (Senden und Empfangen)
function felderBlock(kette) {
  const aus = el('div');
  const typ = kette.typ.art === 'std' ? t('cod.type.std') : t('cod.type.free');
  aus.append(el('div', 'zeile', `${t('cod.type')}: ${typ}  (i3 = ${kette.typ.i3}${kette.typ.n3 !== null ? `, n3 = ${kette.typ.n3}` : ''})`));
  const reihe = el('div', 'chips');
  kette.felder.forEach((f, i) => reihe.append(el('div', `feldchip f${i % 6}`, null, [el('b', 'mono', f.label), el('span', '', f.text || '–'), el('span', 'klein mono', `${f.length} ${t('cod.bit')}`)])));
  aus.append(reihe);
  return aus;
}

// Verlauf der verletzten Prüfgleichungen als beschriftete Balken
function verlaufBlock(verlauf) {
  const v = el('div', 'verlauf', null, [el('div', 'klein', t('cod.flip.history'))]);
  const max = Math.max(...verlauf, 1);
  verlauf.forEach((w, i) => v.append(el('div', 'balkenzeile', null, [
    el('span', 'mono klein', i === 0 ? t('cod.flip.start') : String(i)),
    el('span', 'balken', null, [Object.assign(el('span', 'fuellung'), { style: `width:${(w / max) * 100}%` })]),
    el('span', 'mono klein', String(w)),
  ])));
  return v;
}

// Raster der 174 Bits als Zellen: Zahl = harte Entscheidung aus dem Vorzeichen des LLR, Farbe = Entscheidung (blau 0,
// orange 1), Sättigung = Sicherheit, Rahmen bei b.korrigiert (die Bedeutung nennt rahmenText).
function llrRaster(inhalt, bits, rahmenText) {
  const llrMax = 8; // ab diesem Betrag gilt ein Bit als „voll sicher“ (die LLR sind auf feste Varianz normiert)
  for (const a of BIT_ABSCHNITTE) {
    inhalt.append(el('div', 'abschnitt', `${t(`cod.section.${a.id}`)}  (${a.von}–${a.bis - 1})`));
    const zellen = el('div', 'zellen');
    for (let i = a.von; i < a.bis; i++) {
      const b = bits[i];
      const z = el('span', `zelle llr${b.hart}${b.korrigiert ? ' fix' : ''}`, String(b.hart));
      z.style.setProperty('--s', String(Math.min(1, Math.abs(b.llr) / llrMax)));
      const info = `${t('cod.bit')} ${i}: LLR ${b.llr > 0 ? '+' : b.llr < 0 ? '−' : ''}${zahl(Math.abs(b.llr), 1)}${b.korrigiert ? `, ${rahmenText}` : ''}`;
      z.title = info;
      z.setAttribute('aria-label', info);
      zellen.append(z);
    }
    inhalt.append(zellen);
  }
}

export function erzeugeCodierungsAnsicht({ profil, meldung, audio, qsoAktiv, startText }) {
  let kette = null;
  let gekippt = new Set();
  let fsModus = 'hart'; // Fehlerschutz: 'hart' (Bits kippen) oder 'weich' (simulierter Kanal mit LLR)
  const weich = { snr: -19, seed: 1, zaehlung: null };
  let spiel = null;
  let signalOffen = false;
  let zeitgeber = 0;
  let letzterText = null;

  const wurzel = $('kette');

  // -------------------------------------------------------------------------------------------
  function felderKarte(inhalt) {
    inhalt.append(felderBlock(kette));
  }

  function bitsKarte(inhalt) {
    const reihe = el('div', 'bloecke');
    kette.felder.forEach((f, i) => {
      reihe.append(el('div', `feldblock f${i % 6}`, null, [
        el('div', 'kopf', null, [el('b', 'mono', f.label), el('span', '', ` ${f.text || '–'}`)]),
        el('div', 'bits mono', gruppiert(f.bits)),
        el('div', 'klein mono', `${t('cod.pos')} ${f.start}–${f.start + f.length - 1} · ${t('cod.value')} ${f.value}`),
      ]));
    });
    inhalt.append(reihe, el('div', 'klein mono', `${t('cod.total')}: ${kette.bits77.join('')}`));
  }

  function crcKarte(inhalt) {
    inhalt.append(
      el('div', 'zeile', t('cod.crc.input')),
      el('div', 'bits mono', gruppiert([...kette.bits77, 0, 0, 0, 0, 0])),
      el('div', 'zeile', `${t('cod.crc.result')}: ${kette.crc.bits.join('')} (${t('cod.value')} ${kette.crc.wert})`),
      el('div', 'zeile', `${t('cod.crc.total')}: 77 + 14 = 91 ${t('cod.bit')}`),
      el('div', 'bits mono', gruppiert(kette.bits91)),
    );
  }

  function abschnittsReihen(inhalt, bits, interaktiv) {
    for (const a of BIT_ABSCHNITTE) {
      const kopf = el('div', 'abschnitt', `${t(`cod.section.${a.id}`)}  (${a.von}–${a.bis - 1})`);
      const zellen = el('div', 'zellen');
      for (let i = a.von; i < a.bis; i++) {
        const z = interaktiv ? el('button', `zelle ${a.id}`, String(bits[i])) : el('span', `zelle ${a.id}`, String(bits[i]));
        if (interaktiv) {
          z.type = 'button';
          z.setAttribute('aria-pressed', String(gekippt.has(i)));
          z.setAttribute('aria-label', `${t('cod.bit')} ${i}: ${bits[i]}`);
          z.addEventListener('click', () => { gekippt.has(i) ? gekippt.delete(i) : gekippt.add(i); zeichneFehlerschutz(); });
        }
        zellen.append(z);
      }
      inhalt.append(kopf, zellen);
    }
  }

  function ldpcKarte(inhalt) {
    inhalt.append(el('div', 'zeile', t('cod.ldpc.sizes', { m: LDPC_M })));
    abschnittsReihen(inhalt, kette.bits174, false);
  }

  // -------------------------------------------------------------------------------------------
  let fehlerBox = null;
  function fehlerschutzKarte(inhalt) {
    fehlerBox = el('div', 'fehlerbox');
    inhalt.append(fehlerBox);
    zeichneFehlerschutz();
  }

  function modusSchalter() {
    const g = el('div', 'segmente');
    g.setAttribute('role', 'group');
    for (const [id, key] of [['hart', 'cod.fs.hard'], ['weich', 'cod.fs.soft']]) {
      const b = el('button', '', t(key));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(fsModus === id));
      b.addEventListener('click', () => { fsModus = id; zeichneFehlerschutz(); });
      g.append(b);
    }
    return g;
  }

  function ergebnisBlock(titel, r) {
    const aus = el('div', 'messblock');
    aus.append(el('div', 'abschnitt', titel));
    const zeile = (k, w) => aus.append(el('div', 'messzeile', null, [el('span', '', k), el('span', 'mono', w)]));
    zeile(t('cod.flip.rounds'), String(r.iterationen));
    zeile(t('cod.flip.wrongAfter'), String(r.falscheBitsNachher));
    zeile(t('cod.flip.crc'), r.gueltigesCodewort ? (r.crcOk ? 'ok' : t('cod.flip.crcBad')) : '–');
    const urteil = el('div', `urteil ${r.korrigiert ? 'ok' : 'warn'}`);
    urteil.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${r.korrigiert ? 'check' : 'warning'}"/></svg>`;
    urteil.append(el('span', '', r.korrigiert ? t('cod.flip.fixed', { text: r.text }) : r.gueltigesCodewort ? t('cod.flip.otherWord', { text: r.text ?? '–' }) : t('cod.flip.failed')));
    aus.append(urteil);
    if (r.verlauf.length > 1) aus.append(verlaufBlock(r.verlauf));
    return aus;
  }

  // Weiche Werte: dieselbe Störung für zwei Decoder, nur harte Bits gegen LLR
  function zeichneWeich() {
    const kt = profil().kt;
    const v = vergleicheDecoder(kette.bits174, { snrDb: weich.snr, kt, seed: weich.seed });
    fehlerBox.append(el('p', 'hint body-sm', t('cod.soft.hint')));
    const steuer = el('div', 'aktionsleiste');
    const feld = el('label', 'feld', null, [el('span', '', t('cod.soft.snr'))]);
    const eingabe = el('input');
    eingabe.type = 'number'; eingabe.min = '-40'; eingabe.max = '0'; eingabe.step = '1'; eingabe.value = String(weich.snr);
    eingabe.addEventListener('change', () => {
      const w = Number(eingabe.value);
      if (Number.isFinite(w)) { weich.snr = Math.max(-40, Math.min(0, Math.round(w))); weich.zaehlung = null; }
      zeichneFehlerschutz();
    });
    feld.append(eingabe);
    const wuerfeln = el('button', 'btn tonal', t('cod.soft.dice'));
    wuerfeln.type = 'button';
    wuerfeln.addEventListener('click', () => { weich.seed = Math.floor(Math.random() * 1e6); zeichneFehlerschutz(); });
    steuer.append(feld, wuerfeln);
    fehlerBox.append(steuer, el('div', 'klein', t('cod.soft.profile', { kt, sec: 15 * kt })));
    const bits = Array.from(v.kanal.llr, (llr, nr) => ({ nr, llr, hart: llr > 0 ? 1 : 0, korrigiert: (llr > 0 ? 1 : 0) !== kette.bits174[nr] }));
    llrRaster(fehlerBox, bits, t('cod.soft.wrong'));
    fehlerBox.append(el('div', 'klein', t('cod.soft.legend')));
    fehlerBox.append(el('div', 'zeile', t('cod.soft.wrongCount', { n: v.fehlerHart, v: v.hart.fehlerVorher })));
    fehlerBox.append(ergebnisBlock(t('cod.soft.hardTitle'), v.hart), ergebnisBlock(t('cod.soft.softTitle'), v.weich));
    // Wie oft gelingt es? 100 Versuche mit wechselndem Rauschen bei diesem Rauschabstand
    const zaehle = el('button', 'btn text', t('cod.soft.count'));
    zaehle.type = 'button';
    zaehle.addEventListener('click', () => { weich.zaehlung = haeufigkeit(kette.bits174, { snrDb: weich.snr, kt, n: 100 }); zeichneFehlerschutz(); });
    fehlerBox.append(el('div', 'aktionsleiste', null, [zaehle]));
    if (weich.zaehlung) {
      const z = weich.zaehlung;
      fehlerBox.append(el('div', 'zeile', t('cod.soft.countResult', { snr: weich.snr, n: z.n, w: z.weich, h: z.hart, f: zahl(z.mittlereFehler, 1) })));
    }
  }

  function zeichneFehlerschutz() {
    if (!fehlerBox || !kette) return;
    fehlerBox.replaceChildren();
    fehlerBox.append(modusSchalter());
    if (fsModus === 'weich') { zeichneWeich(); return; }
    const empfangen = kippe(kette.bits174, [...gekippt]);
    const steuer = el('div', 'aktionsleiste');
    const n = el('label', 'feld', null, [el('span', '', t('cod.flip.count'))]);
    const eingabe = el('input');
    eingabe.type = 'number'; eingabe.min = '1'; eingabe.max = '60'; eingabe.value = String(Math.max(1, Math.min(60, gekippt.size || 5)));
    n.append(eingabe);
    const zufall = el('button', 'btn tonal', t('cod.flip.random'));
    zufall.type = 'button';
    zufall.addEventListener('click', () => {
      const anzahl = Math.max(1, Math.min(60, Math.round(Number(eingabe.value)) || 1));
      gekippt = new Set(zufallsFehler(174, anzahl, Math.floor(Math.random() * 1e6)));
      zeichneFehlerschutz();
    });
    const zurueck = el('button', 'btn text', t('cod.flip.reset'));
    zurueck.type = 'button';
    zurueck.addEventListener('click', () => { gekippt = new Set(); zeichneFehlerschutz(); });
    steuer.append(n, zufall, zurueck);
    fehlerBox.append(el('p', 'hint body-sm', t('cod.flip.hint')), steuer);
    abschnittsReihen(fehlerBox, empfangen, true);
    // Gekippte Bits sind zusätzlich zur Farbe mit Rahmen und durchgestrichen markiert (siehe CSS aria-pressed)
    const r = pruefeUndKorrigiere(empfangen, kette.bits174);
    const aus = el('div', 'messblock');
    const zeile = (k, w) => aus.append(el('div', 'messzeile', null, [el('span', '', k), el('span', 'mono', w)]));
    zeile(t('cod.flip.flipped'), String(gekippt.size));
    zeile(t('cod.flip.violated'), `${r.fehlerVorher} / ${LDPC_M}`);
    if (gekippt.size) {
      zeile(t('cod.flip.rounds'), String(r.iterationen));
      zeile(t('cod.flip.wrongAfter'), String(r.falscheBitsNachher));
      zeile(t('cod.flip.crc'), r.gueltigesCodewort ? (r.crcOk ? 'ok' : t('cod.flip.crcBad')) : '–');
    }
    fehlerBox.append(aus);
    const urteil = el('div', `urteil ${r.korrigiert ? 'ok' : 'warn'}`);
    urteil.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${r.korrigiert ? 'check' : 'warning'}"/></svg>`;
    const text = !gekippt.size ? t('cod.flip.none')
      : r.korrigiert ? t('cod.flip.fixed', { text: r.text })
        : r.gueltigesCodewort ? t('cod.flip.otherWord', { text: r.text ?? '–' }) : t('cod.flip.failed');
    urteil.append(el('span', '', text));
    fehlerBox.append(urteil);
    if (gekippt.size && r.verlauf.length > 1) fehlerBox.append(verlaufBlock(r.verlauf));
  }

  // -------------------------------------------------------------------------------------------
  function toeneKarte(inhalt) {
    const gray = el('div', 'chips');
    for (let b = 0; b < 8; b++) gray.append(el('div', 'chip kleinchip mono', `${b.toString(2).padStart(3, '0')} → ${GRAY[b]}`));
    inhalt.append(el('div', 'klein', t('cod.gray')), gray, el('div', 'klein', t('cod.groups')));
    const gruppen = el('div', 'chips');
    for (const g of kette.gruppen) gruppen.append(el('div', 'chip kleinchip mono', `${String(g.nummer).padStart(2, '0')}: ${g.bits.join('')}→${g.ton}`));
    inhalt.append(gruppen);
  }

  function symboleKarte(inhalt) {
    const zellB = 10, zellH = 16, links = 20, oben = 34;
    const cv = el('canvas');
    cv.width = links + 79 * zellB + 4; cv.height = oben + 8 * zellH + 4;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', t('cod.symbols.label'));
    const g = cv.getContext('2d');
    const stil = getComputedStyle(document.documentElement);
    const farbe = (n) => stil.getPropertyValue(n).trim();
    g.font = '10px "Roboto Mono", monospace';
    g.fillStyle = farbe('--md-on-surface-variant');
    g.textAlign = 'right';
    for (let tn = 0; tn < 8; tn++) g.fillText(String(tn), links - 4, oben + (7 - tn) * zellH + 12);
    const blocks = [[0, 7, t('cod.symbols.costas', { n: 1 })], [7, 36, t('cod.symbols.data', { a: 1, b: 29 })], [36, 43, t('cod.symbols.costas', { n: 2 })], [43, 72, t('cod.symbols.data', { a: 30, b: 58 })], [72, 79, t('cod.symbols.costas', { n: 3 })]];
    g.textAlign = 'left';
    blocks.forEach(([a, b, name], i) => {
      const x0 = links + a * zellB, x1 = links + b * zellB;
      g.strokeStyle = farbe('--md-outline'); g.beginPath(); g.moveTo(x0 + 1, oben - 6 - (i % 2) * 12); g.lineTo(x1 - 1, oben - 6 - (i % 2) * 12); g.stroke();
      g.fillStyle = farbe('--md-on-surface'); g.fillText(b - a > 8 ? name : name.replace(/^\D+/, 'C'), x0 + 2, oben - 10 - (i % 2) * 12);
    });
    for (const s of kette.symbole) {
      const x = links + s.nr * zellB, y = oben + (7 - s.ton) * zellH;
      if (s.art === 'costas') {
        g.strokeStyle = farbe('--serie-2'); g.lineWidth = 2; g.strokeRect(x + 1.5, y + 1.5, zellB - 3, zellH - 3); g.lineWidth = 1;
      } else {
        g.fillStyle = farbe('--serie-1'); g.fillRect(x + 1, y + 1, zellB - 2, zellH - 2);
      }
    }
    const rahmen = el('div', 'scrollx', null, [cv]);
    inhalt.append(rahmen, el('div', 'klein', t('cod.symbols.legend')));
  }

  // -------------------------------------------------------------------------------------------
  function signalKarte(inhalt) {
    const p = profil();
    const aktionen = el('div', 'aktionsleiste');
    const play = el('button', 'btn tonal', null, [el('span', '', t('cod.play'))]);
    play.type = 'button';
    play.addEventListener('click', abspielen);
    const speichern = el('button', 'btn tonal', null, [el('span', '', t('cod.saveWav'))]);
    speichern.type = 'button';
    speichern.addEventListener('click', speichereWav);
    aktionen.append(play, speichern);
    inhalt.append(el('div', 'klein', t('cod.signal.profile', { sec: zahl(p.signalSec, 1), spacing: zahl(p.toneSpacing), f0: Math.round(p.f0) })), aktionen);
    const cv = el('canvas');
    cv.id = 'codSpektro';
    cv.width = 360; cv.height = 360;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', t('cod.signal.label'));
    inhalt.append(el('div', 'diagramm', null, [cv]), el('div', 'klein', t('cod.signal.note')));
    zeichneSignal(cv);
  }

  function zeichneSignal(cv) {
    const p = profil();
    const v = vorschauSpektrogramm(synthesizeGfsk(kette.symbole.map((s) => s.ton), p), p);
    const L = 40, B = 24, T = 6, R = 6;
    const W = cv.width, H = cv.height;
    const pw = W - L - R, ph = H - T - B;
    const g = cv.getContext('2d');
    const stil = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    let max = -200;
    for (const z of v.zeilen) for (const x of z) if (x > max) max = x;
    // Bild: eine Pixelzeile je Spektrumzeile, je Spalte das Maximum der Bins im Frequenzbereich der Spalte
    const bild = new ImageData(pw, v.zeilen.length);
    const proSpalte = (v.fHi - v.fLo) / pw;
    for (let r = 0; r < v.zeilen.length; r++) {
      const z = v.zeilen[r];
      for (let x = 0; x < pw; x++) {
        const a = Math.floor((x * proSpalte) / v.binHz), b = Math.max(a, Math.floor(((x + 1) * proSpalte) / v.binHz));
        let m = -200;
        for (let k = a; k <= b && k < z.length; k++) if (z[k] > m) m = z[k];
        const [cr, cg, cb] = colorFor(m, max - 40, max);
        const o = (r * pw + x) * 4;
        bild.data[o] = cr; bild.data[o + 1] = cg; bild.data[o + 2] = cb; bild.data[o + 3] = 255;
      }
    }
    const aus = document.createElement('canvas');
    aus.width = pw; aus.height = v.zeilen.length;
    aus.getContext('2d').putImageData(bild, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(aus, L, T, pw, ph);
    // Soll-Verlauf: je Symbol der gesendete Ton als Stufenlinie (ohne die Gauß-Übergänge)
    const xTon = (tn) => L + ((p.f0 + tn * p.toneSpacing - v.fLo) / (v.fHi - v.fLo)) * pw;
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.setLineDash([]);
    g.beginPath();
    kette.symbole.forEach((s, i) => {
      const y0 = T + (i / 79) * ph, y1 = T + ((i + 1) / 79) * ph;
      if (i === 0) g.moveTo(xTon(s.ton), y0); else g.lineTo(xTon(s.ton), y0);
      g.lineTo(xTon(s.ton), y1);
    });
    g.stroke();
    g.strokeStyle = '#000000'; g.lineWidth = 1;
    g.stroke();
    g.font = '11px "Roboto Mono", monospace';
    g.fillStyle = stil.getPropertyValue('--md-on-surface-variant').trim();
    g.strokeStyle = stil.getPropertyValue('--md-outline').trim();
    g.textAlign = 'center';
    for (let tn = 0; tn < 8; tn++) {
      const x = L + ((p.f0 + tn * p.toneSpacing - v.fLo) / (v.fHi - v.fLo)) * pw;
      g.beginPath(); g.moveTo(x, H - B); g.lineTo(x, H - B + 4); g.stroke();
      g.fillText(String(tn), x, H - B + 16);
    }
    g.textAlign = 'right';
    const schritt = p.signalSec > 40 ? 10 : p.signalSec > 20 ? 5 : 2;
    for (let s = 0; s <= p.signalSec; s += schritt) g.fillText(`${s} s`, L - 4, T + (s / p.signalSec) * ph + 4);
  }

  // Das ganze Zeitfenster (mit dem Startversatz), wie WSJT-X es erwartet: 12 kHz, 16 Bit, mono
  function speichereWav() {
    const p = profil();
    const name = dateinameSignal({ text: kette.text, f0: p.f0, kt: p.kt, kf: p.kf });
    herunterladen(encodeWav(renderSlot(kette.symbole.map((s) => s.ton), p), SAMPLE_RATE), name, 'audio/wav');
    meldung(t('cod.wavSaved', { name }));
  }

  async function abspielen() {
    if (qsoAktiv()) { meldung(t('lab.qsoActive')); return; }
    try {
      spiel?.stop();
      const p = profil();
      spiel = await audio.ausgabe.play(synthesizeGfsk(kette.symbole.map((s) => s.ton), p), SAMPLE_RATE, null);
    } catch (e) { meldung(t('qso.micError', { msg: e.message })); }
  }

  // -------------------------------------------------------------------------------------------
  // Empfangsrichtung: Zwischenwerte eines decodierten Signals
  let empfangDaten = null; // { zw, zeitMs, parity }
  let ansicht = 'senden';
  const empfangWurzel = $('empfang');

  function empfangSignalKarte(inhalt, zw) {
    const aus = el('div', 'messblock');
    messZeile(aus, t('cod.recv.text'), zw.text);
    messZeile(aus, 'DT', `${vorz(zw.dtSec)}${zahl(Math.abs(zw.dtSec), 2)} s`);
    messZeile(aus, 'f0', `${zahl(zw.f0, 1)} Hz`);
    messZeile(aus, t('cod.recv.snr'), `${zahl(zw.snrDb, 0)} dB`);
    messZeile(aus, t('cod.recv.window'), t(`cod.recv.window.${zw.fenster}`));
    messZeile(aus, t('cod.recv.score'), `${zahl(zw.score, 1)} dB`);
    messZeile(aus, t('cod.recv.profile'), `${15 * zw.profil.kt} s, ${zahl(6.25 * zw.profil.kf)} Hz`);
    if (empfangDaten.zeitMs) messZeile(aus, t('cod.recv.time'), `${hms(empfangDaten.zeitMs)} UTC`);
    inhalt.append(aus);
    const nach = el('button', 'btn tonal', t('cod.recv.toSend'));
    nach.type = 'button';
    nach.addEventListener('click', () => { $('codText').value = zw.text; waehleAnsicht('senden'); aktualisieren(); });
    inhalt.append(el('div', 'aktionsleiste', null, [nach]));
  }

  function empfangLeistungenKarte(inhalt, e) {
    const zellB = 10, zellH = 16, links = 20, oben = 34;
    const cv = el('canvas');
    cv.width = links + 79 * zellB + 4; cv.height = oben + 8 * zellH + 4;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', t('cod.recv.heat.label'));
    const g = cv.getContext('2d');
    const stil = getComputedStyle(document.documentElement);
    const farbe = (n) => stil.getPropertyValue(n).trim();
    let max = -300;
    for (const s of e.symbole) for (const x of s.pegelDb) if (x > max) max = x;
    for (const s of e.symbole) {
      for (let tn = 0; tn < 8; tn++) {
        const [r, gr, b] = colorFor(s.pegelDb[tn], max - 35, max);
        g.fillStyle = `rgb(${r},${gr},${b})`;
        g.fillRect(links + s.nr * zellB, oben + (7 - tn) * zellH, zellB - 1, zellH - 1);
      }
      // Der gesendete Ton laut Ergebnis: Punkt mit dunklem Rand, auf jeder Farbe sichtbar
      const x = links + s.nr * zellB + zellB / 2 - 0.5, y = oben + (7 - s.erwartet) * zellH + zellH / 2 - 0.5;
      g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI);
      g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#000000'; g.lineWidth = 1; g.stroke();
    }
    g.font = '10px "Roboto Mono", monospace';
    g.fillStyle = farbe('--md-on-surface-variant');
    g.textAlign = 'right';
    for (let tn = 0; tn < 8; tn++) g.fillText(String(tn), links - 4, oben + (7 - tn) * zellH + 12);
    const blocks = [[0, 7, t('cod.symbols.costas', { n: 1 })], [7, 36, t('cod.symbols.data', { a: 1, b: 29 })], [36, 43, t('cod.symbols.costas', { n: 2 })], [43, 72, t('cod.symbols.data', { a: 30, b: 58 })], [72, 79, t('cod.symbols.costas', { n: 3 })]];
    g.textAlign = 'left';
    blocks.forEach(([a, b, name], i) => {
      const x0 = links + a * zellB, x1 = links + b * zellB;
      g.strokeStyle = farbe('--md-outline'); g.beginPath(); g.moveTo(x0 + 1, oben - 6 - (i % 2) * 12); g.lineTo(x1 - 1, oben - 6 - (i % 2) * 12); g.stroke();
      g.fillStyle = farbe('--md-on-surface'); g.fillText(b - a > 8 ? name : name.replace(/^\D+/, 'C'), x0 + 2, oben - 10 - (i % 2) * 12);
    });
    inhalt.append(el('div', 'scrollx', null, [cv]), el('div', 'klein', t('cod.recv.heat.legend')));
    inhalt.append(el('div', 'zeile', t('cod.recv.heat.summary', { all: e.trefferGesamt, c: e.trefferCostas, d: e.trefferDaten })));
  }

  function empfangLlrKarte(inhalt, e) {
    llrRaster(inhalt, e.bits, t('cod.recv.llr.flipped'));
    inhalt.append(el('div', 'klein', t('cod.recv.llr.legend')));
    inhalt.append(el('div', 'zeile', t('cod.recv.llr.summary', { u: e.unsicherAnzahl, k: e.korrigiertAnzahl })));
  }

  function empfangBpKarte(inhalt, e) {
    const aus = el('div', 'messblock');
    messZeile(aus, t('cod.recv.bp.start'), `${e.bp.verlauf[0]} / ${LDPC_M}`);
    messZeile(aus, t('cod.recv.bp.rounds'), String(e.bp.durchlaeufe));
    messZeile(aus, t('cod.recv.bp.end'), `${e.bp.verlauf.at(-1)} / ${LDPC_M}`);
    inhalt.append(aus);
    if (e.bp.verlauf.length > 1) inhalt.append(verlaufBlock(e.bp.verlauf));
    else inhalt.append(el('div', 'zeile', t('cod.recv.bp.none')));
  }

  function empfangCrcKarte(inhalt, e, zw) {
    const bits14 = Array.from(zw.bits174.subarray(77, 91)).join('');
    const aus = el('div', 'messblock');
    messZeile(aus, t('cod.recv.crc.received'), `${bits14} (${zw.crc.extracted})`);
    messZeile(aus, t('cod.recv.crc.computed'), String(zw.crc.computed));
    messZeile(aus, t('cod.recv.crc.result'), zw.crc.ok ? t('cod.recv.crc.ok') : t('cod.flip.crcBad'));
    messZeile(aus, t('cod.recv.text'), zw.text);
    inhalt.append(aus);
    if (e.kette) inhalt.append(felderBlock(e.kette));
  }

  function bauEmpfang() {
    empfangWurzel.replaceChildren();
    if (!empfangDaten) {
      empfangWurzel.append(el('div', 'card', null, [el('p', 'hint', t('cod.recv.empty'))]));
      return;
    }
    let e;
    try { e = baueEmpfang(empfangDaten.zw); } catch { empfangWurzel.append(el('div', 'card', null, [el('p', 'hint', t('cod.recv.broken'))])); return; }
    const zw = empfangDaten.zw;
    const defs = [
      [1, empfangSignalKarte, [zw], true],
      [2, empfangLeistungenKarte, [e], true],
      [3, empfangLlrKarte, [e], false],
      [4, empfangBpKarte, [e], false],
      [5, empfangCrcKarte, [e, zw], false],
    ];
    for (const [nr, fuelle, args, offen] of defs) {
      const k = karte(nr, `cod.e${nr}`, offen);
      fuelle(k.inhalt, ...args);
      empfangWurzel.append(k.d);
    }
  }

  function waehleAnsicht(name) {
    ansicht = name;
    for (const b of document.querySelectorAll('#segCod button')) b.setAttribute('aria-pressed', String(b.dataset.ansicht === name));
    $('cod-senden').hidden = name !== 'senden';
    $('cod-empfang').hidden = name !== 'empfang';
    if (name === 'empfang') bauEmpfang();
  }
  for (const b of document.querySelectorAll('#segCod button')) b.addEventListener('click', () => waehleAnsicht(b.dataset.ansicht));

  // -------------------------------------------------------------------------------------------
  function bauKarten() {
    wurzel.replaceChildren();
    const defs = [
      [1, felderKarte, true],
      [2, bitsKarte, true],
      [3, crcKarte, false],
      [4, ldpcKarte, false],
      [5, fehlerschutzKarte, false],
      [6, toeneKarte, false],
      [7, symboleKarte, false],
      [8, signalKarte, false],
    ];
    for (const [nr, fuelle, offen] of defs) {
      const k = karte(nr, `cod.c${nr}`, offen);
      if (nr !== 8) fuelle(k.inhalt);
      wurzel.append(k.d);
      if (nr === 8) {
        // Das Spektrogramm wird nur gerechnet, wenn die Karte offen ist (bei langen Profilen nicht billig)
        k.inhalt.replaceChildren();
        const fuelleLazy = () => { if (k.d.open && !k.inhalt.firstChild) signalKarte(k.inhalt); };
        k.d.addEventListener('toggle', () => { signalOffen = k.d.open; fuelleLazy(); });
        if (signalOffen) { k.d.open = true; fuelleLazy(); }
      }
    }
  }

  function aktualisieren() {
    const text = $('codText').value;
    const warn = $('codWarn');
    try {
      kette = baueKette(text);
      warn.textContent = '';
      if (text !== letzterText) { gekippt = new Set(); letzterText = text; }
      bauKarten();
    } catch (e) {
      kette = null;
      const bekannt = ['typ2_nicht_unterstuetzt', 'typ4_nicht_unterstuetzt', 'zu_lang', 'zeichen', 'rapport', 'leer', 'call'];
      warn.textContent = bekannt.includes(e.code) ? t(`cod.err.${e.code}`, { msg: e.message }) : (e.message === 'Nachricht fehlt' ? t('cod.err.leer') : e.message);
      wurzel.replaceChildren();
    }
  }

  $('codText').addEventListener('input', () => { clearTimeout(zeitgeber); zeitgeber = setTimeout(aktualisieren, 200); });
  $('codText').value = startText();
  aktualisieren();

  return {
    // Nachricht von außen setzen, zum Beispiel aus der Nachrichtenliste
    zeige(text) { $('codText').value = text; aktualisieren(); },
    neuZeichnen() { aktualisieren(); if (ansicht === 'empfang') bauEmpfang(); },
    profilGeaendert() { if (kette && signalOffen) aktualisieren(); },
    // Zwischenwerte eines decodierten Signals ansehen: { zw, zeitMs, parity }
    zeigeEmpfang(daten) { empfangDaten = daten; waehleAnsicht('empfang'); },
  };
}
