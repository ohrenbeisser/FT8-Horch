// Schätzt den Zeitpunkt des ersten Abtastwerts einer Aufnahme laufend nach.
//
// Jeder Block kommt im Hauptthread nie früher an als er aufgenommen wurde, aber oft später (Verzögerung durch Last,
// Planung, Nachrichtenweg). Aus "Ankunftszeit minus Dauer der bisher gezählten Abtastwerte" entsteht darum für jeden Block
// eine Schätzung des Starts, die höchstens zu groß ist. Der kleinste Wert der letzten Minuten ist die beste Schätzung, und weil
// er sich mit der Zeit mitbewegt, folgt er auch der Abweichung zwischen Audiotakt und Systemuhr (typisch 10 bis 100 ppm).
// Bei 50 ppm und zwei Minuten Fenster bleibt der Rest unter 6 ms.

export class StartSchaetzer {
  // eimerSec: Breite eines Zeitabschnitts, anzahl: so viele Abschnitte bleiben im Fenster (Vorgabe 12 x 10 s = 2 min)
  constructor({ eimerSec = 10, anzahl = 12 } = {}) {
    this.eimerSec = eimerSec;
    this.anzahl = anzahl;
    this.eimer = new Map(); // Nummer des Abschnitts -> kleinster Wert darin
  }

  // aufnahmeSec: Dauer der bisher gezählten Aufnahme (zählt die Zeit des Takts, nicht der Systemuhr).
  // schaetzungMs: Start nach diesem Block. Rückgabe: der beste Start über das Fenster.
  fuegeHinzu(aufnahmeSec, schaetzungMs) {
    const nr = Math.floor(aufnahmeSec / this.eimerSec);
    const alt = this.eimer.get(nr);
    if (alt === undefined || schaetzungMs < alt) this.eimer.set(nr, schaetzungMs);
    for (const k of this.eimer.keys()) if (k <= nr - this.anzahl) this.eimer.delete(k);
    return Math.min(...this.eimer.values());
  }

  zuruecksetzen() {
    this.eimer.clear();
  }
}
