// Nachrichten <-> 77 Bits.
//
// Im Umfang (Stufe A der Studie): Typ 1 (Standard-QSO, mit /R) und Freitext (i3 = 0, n3 = 0).
// Typ 2 (/P) und Typ 4 (nichtstandardisierte Rufzeichen mit Hash) folgen später und werden
// mit einem eigenen Fehlercode abgelehnt, nicht stillschweigend als Freitext gesendet.
//
// Vorlage und Prüfung: ft8_lib (MIT), ft8/message.c und ft8/text.c. Die Felder heißen wie im
// QEX-Artikel (c28, r1, R1, g15, i3).

import { intToBits, bitsToInt, bitsToBigInt } from './bits.js';

const NTOKENS = 2063592;
const MAX22 = 4194304;
const MAXGRID4 = 32400;

// Zeichentabellen, Reihenfolge wie in WSJT-X
const VOLL = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?'; // Freitext, 42 Zeichen
const ALNUM_LEER = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 37
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 36
const ZIFFERN = '0123456789';
const BUCHSTABEN_LEER = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 27

const FREITEXT_LAENGE = 13;
const RAPPORT_MIN = -30;
const RAPPORT_MAX = 32;

export class MessageError extends Error {
  constructor(code, nachricht) {
    super(nachricht ?? code);
    this.name = 'MessageError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------
// Rufzeichen

function packBasecall(call) {
  const laenge = call.length;
  if (laenge < 3) return -1;
  let c6 = '      ';
  if (call.startsWith('3DA0') && laenge > 4 && laenge <= 7) {
    c6 = ('3D0' + call.slice(4)).padEnd(6, ' '); // Eswatini: 3DA0XYZ -> 3D0XYZ
  } else if (call.startsWith('3X') && /[A-Z]/.test(call[2]) && laenge <= 7) {
    c6 = ('Q' + call.slice(2)).padEnd(6, ' '); // Guinea: 3XA0XYZ -> QA0XYZ
  } else if (/\d/.test(call[2]) && laenge <= 6) {
    c6 = call.padEnd(6, ' '); // AB0XYZ
  } else if (/\d/.test(call[1]) && laenge <= 5) {
    c6 = (' ' + call).padEnd(6, ' '); // A0XYZ -> " A0XYZ"
  }
  if (c6.length > 6) return -1;
  const i = [
    ALNUM_LEER.indexOf(c6[0]), ALNUM.indexOf(c6[1]), ZIFFERN.indexOf(c6[2]),
    BUCHSTABEN_LEER.indexOf(c6[3]), BUCHSTABEN_LEER.indexOf(c6[4]), BUCHSTABEN_LEER.indexOf(c6[5]),
  ];
  if (i.some((x) => x < 0)) return -1;
  return ((((i[0] * 36 + i[1]) * 10 + i[2]) * 27 + i[3]) * 27 + i[4]) * 27 + i[5];
}

// Wert und Suffix-Bit für ein Rufzeichen, Sonderwort oder CQ mit Zusatz. null, wenn nicht packbar.
function packCall28(token) {
  if (token === 'DE') return { n28: 0, ip: 0 };
  if (token === 'QRZ') return { n28: 1, ip: 0 };
  if (token === 'CQ') return { n28: 2, ip: 0 };
  const cq = /^CQ (\d{3}|[A-Z]{1,4})$/.exec(token);
  if (cq) {
    if (/^\d/.test(cq[1])) return { n28: 3 + Number(cq[1]), ip: 0 };
    let m = 0;
    for (const b of cq[1]) m = 27 * m + (b.charCodeAt(0) - 64);
    return { n28: 3 + 1000 + m, ip: 0 };
  }
  const ip = token.endsWith('/R') ? 1 : 0;
  const basis = ip ? token.slice(0, -2) : token;
  const n = packBasecall(basis);
  if (n < 0) return null;
  return { n28: NTOKENS + MAX22 + n, ip };
}

function ausgabeRufzeichen(n28, ip, i3) {
  if (n28 < NTOKENS) {
    if (n28 === 0) return 'DE';
    if (n28 === 1) return 'QRZ';
    if (n28 === 2) return 'CQ';
    if (n28 <= 1002) return 'CQ ' + String(n28 - 3).padStart(3, '0');
    if (n28 <= 532443) {
      let n = n28 - 1003;
      let s = '';
      for (let k = 0; k < 4; k++) {
        s = BUCHSTABEN_LEER[n % 27] + s;
        n = Math.floor(n / 27);
      }
      return 'CQ ' + s.trim();
    }
    throw new MessageError('call', `Unbekanntes Sonderwort ${n28}`);
  }
  let n = n28 - NTOKENS;
  if (n < MAX22) return '<...>'; // Hash-Rufzeichen, Auflösung folgt mit Typ 4 (E9)
  n -= MAX22;
  const c = new Array(6);
  c[5] = BUCHSTABEN_LEER[n % 27]; n = Math.floor(n / 27);
  c[4] = BUCHSTABEN_LEER[n % 27]; n = Math.floor(n / 27);
  c[3] = BUCHSTABEN_LEER[n % 27]; n = Math.floor(n / 27);
  c[2] = ZIFFERN[n % 10]; n = Math.floor(n / 10);
  c[1] = ALNUM[n % 36]; n = Math.floor(n / 36);
  c[0] = ALNUM_LEER[n % 37];
  let call = c.join('');
  if (call.startsWith('3D0') && call[3] !== ' ') call = '3DA0' + call.slice(3).trim();
  else if (call[0] === 'Q' && /[A-Z]/.test(call[1])) call = '3X' + call.slice(1).trim();
  else call = call.trim();
  if (call.length < 3) throw new MessageError('call', 'Rufzeichen zu kurz');
  if (ip) {
    if (i3 !== 1) throw new MessageError('call', 'Suffix nur bei Typ 1');
    call += '/R';
  }
  return call;
}

// ---------------------------------------------------------------------------------------
// Locator und Rapport (15 Bit g15 plus Bit R1)

function packGrid(extra) {
  if (extra === '') return { igrid: MAXGRID4 + 1, ir: 0 };
  if (extra === 'RRR') return { igrid: MAXGRID4 + 2, ir: 0 };
  if (extra === 'RR73') return { igrid: MAXGRID4 + 3, ir: 0 };
  if (extra === '73') return { igrid: MAXGRID4 + 4, ir: 0 };
  if (/^[A-R]{2}\d{2}$/.test(extra)) {
    const igrid = ((extra.charCodeAt(0) - 65) * 18 + (extra.charCodeAt(1) - 65)) * 100
      + Number(extra[2]) * 10 + Number(extra[3]);
    return { igrid, ir: 0 };
  }
  const rapport = /^(R?)([+-]\d{2})$/.exec(extra);
  if (rapport) {
    const dd = Number(rapport[2]);
    if (dd < RAPPORT_MIN || dd > RAPPORT_MAX) throw new MessageError('rapport', `Rapport ${extra} außerhalb ${RAPPORT_MIN} bis +${RAPPORT_MAX}`);
    return { igrid: MAXGRID4 + 35 + dd, ir: rapport[1] ? 1 : 0 };
  }
  return null;
}

function ausgabeGrid(igrid, ir) {
  if (igrid <= MAXGRID4) {
    const n = igrid;
    const grid = String.fromCharCode(65 + Math.floor(n / 1800)) + String.fromCharCode(65 + Math.floor(n / 100) % 18)
      + String(Math.floor(n / 10) % 10) + String(n % 10);
    return (ir ? 'R ' : '') + grid;
  }
  const irpt = igrid - MAXGRID4;
  if (irpt === 1) return '';
  if (irpt === 2) return 'RRR';
  if (irpt === 3) return 'RR73';
  if (irpt === 4) return '73';
  const dd = irpt - 35;
  return (ir ? 'R' : '') + (dd < 0 ? '-' : '+') + String(Math.abs(dd)).padStart(2, '0');
}

// ---------------------------------------------------------------------------------------
// Aufbau der 77 Bits

const aehnlichRufzeichen = (t) => /^[A-Z0-9/]{3,11}$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t);

function stdBits(to, de, extra) {
  const a = packCall28(to);
  const b = packCall28(de);
  const g = packGrid(extra);
  if (!a || !b || !g) return null;
  return [
    ...intToBits(a.n28, 28), a.ip, ...intToBits(b.n28, 28), b.ip, g.ir, ...intToBits(g.igrid, 15), ...intToBits(1, 3),
  ];
}

function freitextBits(text) {
  if (text.length > FREITEXT_LAENGE) throw new MessageError('zu_lang', `Freitext hat mehr als ${FREITEXT_LAENGE} Zeichen`);
  let wert = 0n;
  for (const z of text.padEnd(FREITEXT_LAENGE, ' ')) {
    const idx = VOLL.indexOf(z);
    if (idx < 0) throw new MessageError('zeichen', `Zeichen "${z}" im Freitext nicht erlaubt`);
    wert = wert * 42n + BigInt(idx);
  }
  return [...intToBits(wert, 71), ...intToBits(0, 3), ...intToBits(0, 3)];
}

// Aufteilung der Nachricht in Rufzeichen-Teile: "CQ DX DL6LG JO60" -> ["CQ DX", "DL6LG", "JO60"]
function zerlege(text) {
  const wort = text.split(' ');
  if (wort[0] === 'CQ' && wort.length >= 3 && /^(\d{3}|[A-Z]{1,4})$/.test(wort[1])) {
    return [`CQ ${wort[1]}`, ...wort.slice(2)];
  }
  return wort;
}

export function packMessage(eingabe, { free = false } = {}) {
  const text = eingabe.trim().toUpperCase();
  if (text === '') throw new MessageError('leer', 'Keine Nachricht');

  let bits = null;
  if (!free) {
    const teile = zerlege(text.replace(/\s+/g, ' '));
    if (teile.length === 2 || teile.length === 3) {
      const [to, de, extra = ''] = teile;
      if (to.endsWith('/P') || de.endsWith('/P')) {
        throw new MessageError('typ2_nicht_unterstuetzt', 'Rufzeichen mit /P gehören zu Typ 2, noch nicht im Umfang');
      }
      bits = stdBits(to, de, extra);
      const toIstCall = ['CQ', 'QRZ', 'DE'].includes(to) || to.startsWith('CQ ') || aehnlichRufzeichen(to);
      if (!bits && toIstCall && aehnlichRufzeichen(de)) {
        throw new MessageError('typ4_nicht_unterstuetzt', 'Nichtstandardisiertes Rufzeichen braucht Typ 4, noch nicht im Umfang');
      }
    }
  }
  if (!bits) bits = freitextBits(text);

  const nachricht = unpackFields(bits);
  return { bits, ...nachricht };
}

// ---------------------------------------------------------------------------------------
// Entpacken und Feldübersicht

function feld(id, label, start, laenge, bits, anzeige) {
  const value = laenge > 53 ? bitsToBigInt(bits.slice(start, start + laenge)) : bitsToInt(bits.slice(start, start + laenge));
  return { id, label, start, length: laenge, value, text: anzeige };
}

function unpackFields(bits) {
  if (bits.length !== 77) throw new MessageError('laenge', `77 Bits erwartet, ${bits.length} erhalten`);
  const i3 = bitsToInt(bits.slice(74, 77));
  const n3 = bitsToInt(bits.slice(71, 74));

  if (i3 === 0 && n3 === 0) {
    let rest = bitsToBigInt(bits.slice(0, 71));
    let text = '';
    for (let k = 0; k < FREITEXT_LAENGE; k++) {
      text = VOLL[Number(rest % 42n)] + text;
      rest /= 42n;
    }
    text = text.trim();
    return {
      type: 'free',
      i3,
      n3,
      text,
      fields: [
        feld('f71', 'f71', 0, 71, bits, text),
        feld('n3', 'n3', 71, 3, bits, String(n3)),
        feld('i3', 'i3', 74, 3, bits, String(i3)),
      ],
    };
  }
  if (i3 !== 1) throw new MessageError('typ_nicht_unterstuetzt', `Nachrichtentyp i3=${i3}, n3=${n3} nicht im Umfang`);

  const n28a = bitsToInt(bits.slice(0, 28));
  const ip1 = bits[28];
  const n28b = bitsToInt(bits.slice(29, 57));
  const ip2 = bits[57];
  const ir = bits[58];
  const igrid = bitsToInt(bits.slice(59, 74));
  const call1 = ausgabeRufzeichen(n28a, ip1, i3);
  const call2 = ausgabeRufzeichen(n28b, ip2, i3);
  const extra = ausgabeGrid(igrid, ir);
  const text = [call1, call2, extra].filter((t) => t !== '').join(' ');
  return {
    type: 'std',
    i3,
    n3: null,
    text,
    fields: [
      feld('call1', 'c28', 0, 28, bits, call1),
      feld('ip1', 'r1', 28, 1, bits, ip1 ? '/R' : ''),
      feld('call2', 'c28', 29, 28, bits, call2),
      feld('ip2', 'r1', 57, 1, bits, ip2 ? '/R' : ''),
      feld('ack', 'R1', 58, 1, bits, ir ? 'R' : ''),
      feld('grid', 'g15', 59, 15, bits, extra.replace(/^R /, '')),
      feld('i3', 'i3', 74, 3, bits, String(i3)),
    ],
  };
}

export function unpackMessage(bits) {
  return unpackFields(bits);
}
