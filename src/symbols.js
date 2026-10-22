// Von 174 Codewortbits zu 79 Tönen: Dreiergruppen, Gray-Code, Costas-Blöcke.
// Aufbau: S7 D29 S7 D29 S7 (S = Costas-Block, D = Datensymbole).

import { COSTAS, GRAY, LDPC_N, NUM_DATA_SYMBOLS } from './constants.js';

// Die 58 Dreiergruppen mit ihrem Ton (nach Gray-Abbildung)
export function dataGroups(bits174) {
  if (bits174.length !== LDPC_N) throw new RangeError(`${LDPC_N} Bits erwartet, ${bits174.length} erhalten`);
  const gruppen = [];
  for (let i = 0; i < NUM_DATA_SYMBOLS; i++) {
    const bits = bits174.slice(3 * i, 3 * i + 3);
    gruppen.push({ bits, tone: GRAY[bits[0] * 4 + bits[1] * 2 + bits[2]] });
  }
  return gruppen;
}

export function toneSequence(bits174) {
  const daten = dataGroups(bits174).map((g) => g.tone);
  return [...COSTAS, ...daten.slice(0, 29), ...COSTAS, ...daten.slice(29), ...COSTAS];
}
