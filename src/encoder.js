// Gesamtkette des Senders: Text -> 77 Bits -> CRC -> LDPC -> Töne.
// Liefert alle Zwischenschritte mit, damit die Lehransicht sie anzeigen kann.

import { packMessage } from './pack77.js';
import { crc14, addCrc } from './crc14.js';
import { ldpcEncode } from './ldpc.js';
import { dataGroups, toneSequence } from './symbols.js';

export function encodeMessage(text, optionen) {
  const message = packMessage(text, optionen);
  const bits77 = message.bits;
  const bits91 = addCrc(bits77);
  const bits174 = ldpcEncode(bits91);
  return {
    message,
    bits77,
    crc: crc14([...bits77, 0, 0, 0, 0, 0]),
    bits91,
    parity: bits174.slice(91),
    bits174,
    groups: dataGroups(bits174),
    tones: toneSequence(bits174),
  };
}
