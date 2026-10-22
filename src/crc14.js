// CRC-14 des FT8-Protokolls: Polynom 0x2757, Startwert 0, über 82 Bits
// (77 Nachrichtenbits plus 5 Nullen). Geprüft gegen ft8_lib (ftx_compute_crc).

import { intToBits } from './bits.js';

const POLYNOM = 0x2757;
const BREITE = 14;
const MASKE = (1 << BREITE) - 1;

export function crc14(bits) {
  let rest = 0;
  for (const b of bits) {
    const oben = (rest >> (BREITE - 1)) & 1;
    rest = (rest << 1) & MASKE;
    if (oben ^ b) rest ^= POLYNOM;
  }
  return rest;
}

// 77 Bits -> 91 Bits (Nachricht plus CRC)
export function addCrc(bits77) {
  if (bits77.length !== 77) throw new RangeError(`77 Bits erwartet, ${bits77.length} erhalten`);
  const crc = crc14([...bits77, 0, 0, 0, 0, 0]);
  return [...bits77, ...intToBits(crc, BREITE)];
}
