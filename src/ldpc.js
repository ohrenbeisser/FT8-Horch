// LDPC-Code (174, 91): Codieren mit der Generatormatrix, Prüfen und Belief-Propagation-Decodierung.

import {
  LDPC_GENERATOR, LDPC_K, LDPC_M, LDPC_N, LDPC_NM, LDPC_MN, LDPC_NUM_ROWS,
} from './constants.js';

// Generatormatrix als Bits, einmalig aus den gepackten Bytes entfaltet
let generatorBits = null;

function erzeugeGeneratorBits() {
  return LDPC_GENERATOR.map((zeile) => {
    const bits = [];
    for (const byte of zeile) for (let k = 7; k >= 0; k--) bits.push((byte >> k) & 1);
    return bits.slice(0, LDPC_K);
  });
}

// 91 Bits (Nachricht plus CRC) -> 174 Bits (Nachricht, CRC und 83 Paritätsbits)
export function ldpcEncode(bits91) {
  if (bits91.length !== LDPC_K) throw new RangeError(`${LDPC_K} Bits erwartet, ${bits91.length} erhalten`);
  generatorBits ??= erzeugeGeneratorBits();

  const parity = new Array(LDPC_M);
  for (let i = 0; i < LDPC_M; i++) {
    let summe = 0;
    const zeile = generatorBits[i];
    for (let j = 0; j < LDPC_K; j++) summe ^= zeile[j] & bits91[j];
    parity[i] = summe;
  }
  return [...bits91, ...parity];
}

// Anzahl verletzter Prüfgleichungen eines 174-Bit-Wortes (0 = gültiges Codewort)
export function ldpcCheck(bits174) {
  if (bits174.length !== LDPC_N) throw new RangeError(`${LDPC_N} Bits erwartet, ${bits174.length} erhalten`);
  let fehler = 0;
  for (let m = 0; m < LDPC_M; m++) {
    let x = 0;
    for (let i = 0; i < LDPC_NUM_ROWS[m]; i++) x ^= bits174[LDPC_NM[m][i] - 1];
    if (x) fehler++;
  }
  return fehler;
}

const ATANH_GRENZE = 0.9999999;
const atanhBegrenzt = (x) => Math.atanh(Math.max(-ATANH_GRENZE, Math.min(ATANH_GRENZE, x)));

// Belief Propagation (Summe-Produkt-Algorithmus), Vorlage bp_decode in ft8_lib/ft8/ldpc.c (MIT).
// llr: 174 Werte, positiv = Bit 1 (log p(1)/p(0)). Rückgabe:
//   bits: bester Stand (mit den wenigsten verletzten Prüfgleichungen)
//   errors: verletzte Prüfgleichungen dieses Stands, 0 = gültiges Codewort
//   iterations: Anzahl der Durchläufe der Nachrichtenübergabe
//   history: verletzte Prüfgleichungen vor dem ersten und nach jedem Durchlauf (für die Lehransicht)
export function bpDecode(llr, maxIterations = 25) {
  if (llr.length !== LDPC_N) throw new RangeError(`${LDPC_N} LLR-Werte erwartet, ${llr.length} erhalten`);

  const tov = Array.from({ length: LDPC_N }, () => new Float64Array(3)); // Bit -> Prüfgleichung
  const toc = Array.from({ length: LDPC_M }, () => new Float64Array(7)); // Prüfgleichung -> Bit
  const history = [];
  let bestBits = null;
  let bestErrors = LDPC_M + 1;
  let iterations = 0;

  const entscheide = () => {
    const bits = new Array(LDPC_N);
    let summe = 0;
    for (let n = 0; n < LDPC_N; n++) {
      bits[n] = llr[n] + tov[n][0] + tov[n][1] + tov[n][2] > 0 ? 1 : 0;
      summe += bits[n];
    }
    return { bits, summe };
  };

  for (let iter = 0; iter <= maxIterations; iter++) {
    const { bits, summe } = entscheide();
    // Das Nullwort ist beim FT8-Code ausgeschlossen: gilt als Fehlschlag (alle Gleichungen "verletzt")
    const fehler = summe === 0 ? LDPC_M : ldpcCheck(bits);
    history.push(fehler);
    if (fehler < bestErrors) {
      bestErrors = fehler;
      bestBits = bits;
    }
    if (fehler === 0 || iter === maxIterations) break;
    iterations = iter + 1;

    // Nachrichten von den Bits zu den Prüfgleichungen
    for (let m = 0; m < LDPC_M; m++) {
      for (let idx = 0; idx < LDPC_NUM_ROWS[m]; idx++) {
        const n = LDPC_NM[m][idx] - 1;
        let tnm = llr[n];
        for (let k = 0; k < 3; k++) if (LDPC_MN[n][k] - 1 !== m) tnm += tov[n][k];
        toc[m][idx] = Math.tanh(-tnm / 2);
      }
    }
    // Nachrichten von den Prüfgleichungen zu den Bits
    for (let n = 0; n < LDPC_N; n++) {
      for (let k = 0; k < 3; k++) {
        const m = LDPC_MN[n][k] - 1;
        let produkt = 1;
        for (let idx = 0; idx < LDPC_NUM_ROWS[m]; idx++) if (LDPC_NM[m][idx] - 1 !== n) produkt *= toc[m][idx];
        tov[n][k] = -2 * atanhBegrenzt(produkt);
      }
    }
  }
  return { bits: bestBits, errors: bestErrors, iterations, history };
}
