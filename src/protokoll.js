// Textprotokoll: alle Decodierungen und Sendungen mit Zeit, Rapport, DT und Frequenz (wie WSJT-X).
// Das Protokoll ist auf die letzten Zeilen begrenzt. Es bleibt lokal und verlässt das Gerät nur durch den Export.

export const MAX_ZEILEN = 5000;

export class Protokoll {
  constructor(speicher, { max = MAX_ZEILEN } = {}) { this.speicher = speicher; this.max = max; }

  async hinzufuegen(zeilen) {
    if (!zeilen.length) return;
    await this.speicher.hinzufuegenViele(zeilen);
    await this.speicher.begrenze(this.max);
  }

  // Älteste zuerst
  async alle() {
    return (await this.speicher.alle()).sort((x, y) => x.ms - y.ms || x.id - y.id);
  }

  leere() { return this.speicher.leere(); }
}

const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const fenster = (z) => (z.parity === 'even' ? 'g' : 'u');

export function zeileAlsText(z) {
  if (z.typ === 'tx') return `${hms(z.ms)}${fenster(z)} Tx ${Math.round(z.f0)} Hz  ${z.text}`;
  return `${hms(z.ms)}${fenster(z)} ${String(Math.round(z.snr)).padStart(3)} ${z.dt.toFixed(1).padStart(4)} ${String(Math.round(z.f0)).padStart(4)}  ${z.text}`;
}

export const protokollAlsText = (zeilen) => zeilen.map(zeileAlsText).join('\n');

const csvFeld = (s) => (/[;"\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function protokollAlsCsv(zeilen) {
  const kopf = 'datum_utc;zeit_utc;fenster;art;snr_db;dt_s;frequenz_hz;text';
  const rest = zeilen.map((z) => [
    new Date(z.ms).toISOString().slice(0, 10), hms(z.ms), fenster(z), z.typ,
    z.typ === 'rx' ? Math.round(z.snr) : '', z.typ === 'rx' ? z.dt.toFixed(1) : '', Math.round(z.f0), csvFeld(z.text),
  ].join(';'));
  return [kopf, ...rest].join('\n');
}

// art: alle | rx | tx | qso (alles, was mein Rufzeichen enthält, plus meine Sendungen)
export function filtereProtokoll(zeilen, { art = 'alle', text = '', meinCall = '' } = {}) {
  const such = text.trim().toLowerCase();
  const mein = meinCall.trim().toUpperCase();
  return zeilen.filter((z) => {
    if (art === 'rx' && z.typ !== 'rx') return false;
    if (art === 'tx' && z.typ !== 'tx') return false;
    if (art === 'qso' && !(z.typ === 'tx' || (mein && z.text.toUpperCase().split(/\s+/).includes(mein)))) return false;
    return !such || z.text.toLowerCase().includes(such);
  });
}
