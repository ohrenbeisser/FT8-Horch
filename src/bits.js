// Hilfen für Bitfelder. Bits sind Arrays aus 0 und 1, das höchstwertige Bit steht vorn.

// Zahl (Number oder BigInt) als Bitfeld der gegebenen Länge
export function intToBits(wert, laenge) {
  let v = BigInt(wert);
  if (v < 0n) throw new RangeError(`Negativer Wert ${wert}`);
  const bits = new Array(laenge);
  for (let i = laenge - 1; i >= 0; i--) {
    bits[i] = Number(v & 1n);
    v >>= 1n;
  }
  if (v !== 0n) throw new RangeError(`${wert} passt nicht in ${laenge} Bits`);
  return bits;
}

export function bitsToBigInt(bits) {
  let v = 0n;
  for (const b of bits) v = (v << 1n) | BigInt(b);
  return v;
}

// Für Felder bis 53 Bit
export function bitsToInt(bits) {
  return Number(bitsToBigInt(bits));
}
