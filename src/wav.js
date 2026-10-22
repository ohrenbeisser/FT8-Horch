// WAV-Datei schreiben (16 Bit, mono, PCM) und lesen (verschiedene Formate, siehe decodeWav).

const KOPF = 44;

// Float-Abtastwerte (-1 bis 1) -> WAV. Gerundet wird symmetrisch. save_wav in ft8_lib schneidet
// negative Werte ab und liegt dadurch bis zu 1 Bit daneben.
export function encodeWav(samples, sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`Ungültige Abtastrate ${sampleRate}`);
  const datenBytes = samples.length * 2;
  const wav = new Uint8Array(KOPF + datenBytes);
  const v = new DataView(wav.buffer);
  const schreibe = (pos, s) => { for (let i = 0; i < s.length; i++) wav[pos + i] = s.charCodeAt(i); };

  schreibe(0, 'RIFF');
  v.setUint32(4, 36 + datenBytes, true);
  schreibe(8, 'WAVE');
  schreibe(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  schreibe(36, 'data');
  v.setUint32(40, datenBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(KOPF + 2 * i, Math.round(x * 32767), true);
  }
  return wav;
}

// WAV -> Float-Abtastwerte (mono). Gelesen werden PCM mit 8, 16, 24 und 32 Bit sowie 32-Bit-Gleitkomma, ein oder zwei
// Kanäle (Stereo wird gemittelt). Die Datei darf WAVE_FORMAT_EXTENSIBLE nutzen.
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (pos) => String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
  if (bytes.length < KOPF || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new RangeError('Keine WAV-Datei');

  let fmt = null;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const groesse = v.getUint32(pos + 4, true);
    if (text(pos) === 'fmt ') {
      let format = v.getUint16(pos + 8, true);
      const kanaele = v.getUint16(pos + 10, true);
      const bits = v.getUint16(pos + 22, true);
      if (format === 0xfffe && groesse >= 26) format = v.getUint16(pos + 32, true); // Unterformat der erweiterten Kopfzeile
      const pcm = format === 1 && [8, 16, 24, 32].includes(bits);
      const gleitkomma = format === 3 && bits === 32;
      if ((!pcm && !gleitkomma) || (kanaele !== 1 && kanaele !== 2)) throw new RangeError('Nur PCM (8 bis 32 Bit) oder Gleitkomma (32 Bit), ein oder zwei Kanäle');
      fmt = { sampleRate: v.getUint32(pos + 12, true), kanaele, bits, gleitkomma };
    } else if (text(pos) === 'data') {
      if (!fmt) throw new RangeError('fmt-Block fehlt vor den Daten');
      const { sampleRate, kanaele, bits, gleitkomma } = fmt;
      const bytesJe = bits / 8;
      const n = Math.floor(Math.min(groesse, bytes.length - pos - 8) / (bytesJe * kanaele));
      const samples = new Float32Array(n);
      const wert = (o) => {
        if (gleitkomma) return v.getFloat32(o, true);
        if (bits === 16) return v.getInt16(o, true) / 32767;
        if (bits === 8) return (v.getUint8(o) - 128) / 127;
        if (bits === 24) return (((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16)) << 8) >> 8) / 8388607;
        return v.getInt32(o, true) / 2147483647;
      };
      for (let i = 0; i < n; i++) {
        const o = pos + 8 + i * bytesJe * kanaele;
        samples[i] = kanaele === 1 ? wert(o) : (wert(o) + wert(o + bytesJe)) / 2;
      }
      return { samples, sampleRate };
    }
    pos += 8 + groesse + (groesse & 1);
  }
  throw new RangeError('Keine Audiodaten gefunden');
}
