// Maidenhead-Locator aus Koordinaten (und zurück). Alles lokal, nichts verlässt das Gerät.
const A = 'ABCDEFGHIJKLMNOPQR';
const a = 'abcdefghijklmnopqrstuvwx';

// stellen: 4 (Feld und Quadrat, wie in der FT8-Nachricht) oder 6 (mit Unterquadrat in Kleinbuchstaben)
export function maidenhead(lat, lon, stellen = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError(`Koordinaten außerhalb des Bereichs: ${lat}, ${lon}`);
  }
  // Die Grenzen +90 und +180 gehören noch zum letzten Feld
  const y = Math.min(lat + 90, 180 - 1e-9);
  const x = Math.min(lon + 180, 360 - 1e-9);
  const s = A[Math.floor(x / 20)] + A[Math.floor(y / 10)] + Math.floor((x % 20) / 2) + Math.floor(y % 10);
  if (stellen === 4) return s;
  return s + a[Math.floor((x % 2) * 12)] + a[Math.floor((y % 1) * 24)];
}
