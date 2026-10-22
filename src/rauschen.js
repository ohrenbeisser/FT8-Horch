// Wiederholbares weißes Rauschen mit festem Rauschabstand (Tests und Simulator).

// Kleiner, schneller Zufallsgenerator mit Startwert
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalverteilte Zahl (Box-Muller)
export function gauss(zufall) {
  const u = Math.max(zufall(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * zufall());
}

// Mischt Rauschen zu einem Signal. Der Rauschabstand bezieht sich wie bei FT8 üblich auf 2500 Hz
// Bandbreite: SNR = Signalleistung / (Rauschleistungsdichte * 2500 Hz). Die Signalleistung ist die
// mittlere Leistung der Abtastwerte im Signalteil (signalStart bis signalEnde), nicht der Stille.
export function mischeRauschen(signal, snrDb, { rate = 12000, seed = 1, signalStart = 0, signalEnde = signal.length } = {}) {
  let leistung = 0;
  for (let i = signalStart; i < signalEnde; i++) leistung += signal[i] * signal[i];
  leistung /= signalEnde - signalStart;
  const rauschIn2500 = leistung / 10 ** (snrDb / 10);
  const sigma = Math.sqrt(rauschIn2500 * (rate / 2 / 2500)); // weißes Rauschen über rate/2
  const zufall = mulberry32(seed);
  const aus = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) aus[i] = signal[i] + sigma * gauss(zufall);
  return aus;
}
