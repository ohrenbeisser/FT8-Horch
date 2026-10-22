// UTC-Zeitraster der Fenster. Das Fenster beginnt, wenn die Sekunden seit Mitternacht UTC durch die
// Fensterlänge des Profils teilbar sind (15, 30, 60, 120 s). Gerade und ungerade Fenster zählen ab
// Mitternacht UTC; für 15 s entspricht das der Zählung bei WSJT-X (:00 und :30 gerade).

const TAG_MS = 86400000;

// Zustand des Fensters, in dem zeitMs (UTC, Millisekunden seit 1970) liegt
export function slotInfo(zeitMs, profil) {
  const laengeMs = profil.slotSec * 1000;
  const seitMitternacht = ((zeitMs % TAG_MS) + TAG_MS) % TAG_MS;
  const index = Math.floor(seitMitternacht / laengeMs);
  const startMs = zeitMs - seitMitternacht + index * laengeMs;
  return {
    index,
    parity: index % 2 === 0 ? 'even' : 'odd',
    startMs,
    endMs: startMs + laengeMs,
    elapsedSec: (zeitMs - startMs) / 1000,
    remainingSec: (startMs + laengeMs - zeitMs) / 1000,
  };
}

// Beginn des nächsten Fensters, optional mit gewünschter Parität ('even' oder 'odd') und
// Mindestvorlauf in Millisekunden. Ein Fenster, das genau jetzt beginnt, zählt nicht als "nächstes".
export function nextSlotStart(zeitMs, profil, parity = null, mindestVorlaufMs = 0) {
  const laengeMs = profil.slotSec * 1000;
  let info = slotInfo(zeitMs, profil);
  let start = info.endMs;
  for (let i = 0; i < 4; i++) {
    info = slotInfo(start, profil);
    if ((!parity || info.parity === parity) && start - zeitMs >= mindestVorlaufMs) return start;
    start += laengeMs;
  }
  return start;
}

// Uhr mit einstellbarem Versatz (z. B. aus einer Zeitprüfung). Die Systemuhr ist der Normalfall.
export class Clock {
  constructor(jetzt = () => Date.now()) {
    this.jetzt = jetzt;
    this.offsetMs = 0;
  }

  now() {
    return this.jetzt() + this.offsetMs;
  }

  slot(profil) {
    return slotInfo(this.now(), profil);
  }
}
