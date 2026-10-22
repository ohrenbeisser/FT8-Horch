// Zeitprüfung: Wie weit weicht die Uhr dieses Geräts von der Uhr des Servers ab, von dem die App kommt?
//
// Der HTTP-Header Date hat nur ganze Sekunden. Jede Antwort grenzt die Abweichung deshalb auf ein Intervall
// von knapp einer Sekunde ein. Mehrere Anfragen über eine Sekundengrenze hinweg schneiden das Intervall
// auf etwa die Laufzeit der Anfrage zusammen. Es gibt keine Anfrage an Dritte, nur an den eigenen Server.
// Abweichung = Gerätezeit minus wahre Zeit (positiv: das Gerät geht vor).

export const ANFRAGEN = 9;
export const PAUSE_MS = 150; // 9 Anfragen im Abstand von 150 ms decken mehr als eine Sekunde ab

// Intervall [lo, hi] der Abweichung aus einer Antwort. Der Server stempelt bei einer wahren Zeit s im
// Bereich [Datum, Datum + 1 s), und die Gerätezeit lag dabei zwischen Senden und Empfangen.
export function intervallAusAntwort({ sendeMs, empfangMs, serverDatumMs }) {
  return { lo: sendeMs - (serverDatumMs + 1000), hi: empfangMs - serverDatumMs };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

export function schaetzeAbweichung(intervalle) {
  if (!intervalle.length) throw new Error('keine Messung');
  const lo = Math.max(...intervalle.map((i) => i.lo));
  const hi = Math.min(...intervalle.map((i) => i.hi));
  if (lo <= hi) return { abweichungMs: (lo + hi) / 2, unsicherheitMs: (hi - lo) / 2, widerspruch: false };
  // Ausreißer (z. B. verzögerte Antwort): Mitte aller Intervalle, Unsicherheit aus der Streuung
  const mitten = intervalle.map((i) => (i.lo + i.hi) / 2);
  const m = median(mitten);
  const streu = Math.max(...mitten.map((x) => Math.abs(x - m)));
  const halb = median(intervalle.map((i) => (i.hi - i.lo) / 2));
  return { abweichungMs: m, unsicherheitMs: streu + halb, widerspruch: true };
}

// holeDatum() liefert das Datum der Serverantwort in ms, jetzt() die Gerätezeit, warte(ms) pausiert.
export async function pruefeZeit({ holeDatum, jetzt = () => Date.now(), warte = (ms) => new Promise((r) => setTimeout(r, ms)), anfragen = ANFRAGEN, pauseMs = PAUSE_MS }) {
  const intervalle = [];
  let letzterFehler = null;
  for (let i = 0; i < anfragen; i++) {
    if (i) await warte(pauseMs);
    const sendeMs = jetzt();
    try {
      const serverDatumMs = await holeDatum();
      intervalle.push(intervallAusAntwort({ sendeMs, empfangMs: jetzt(), serverDatumMs }));
    } catch (e) { letzterFehler = e; }
  }
  if (!intervalle.length) throw letzterFehler ?? new Error('keine Antwort');
  return { ...schaetzeAbweichung(intervalle), messungen: intervalle.length };
}

// Anfrage an den eigenen Server, am Service Worker und am Cache vorbei (Parameter "zeit")
export async function holeServerDatum(url = 'sw.js') {
  const antwort = await fetch(`${url}?zeit=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
  const d = Date.parse(antwort.headers.get('date') ?? '');
  if (!Number.isFinite(d)) throw new Error('Antwort ohne Datum');
  return d;
}

// Serverzeit als Zeitquelle: Ab dieser Messunsicherheit (ms) wird eine Messung nicht mehr für den Ausgleich genommen
export const MAX_UNSICHERHEIT_MS = 300;

// Ausgleich der App-Uhr (Uhr = Systemzeit + Ausgleich) aus einer Messung, oder null, wenn die Messung dafür nicht taugt
export function offsetAusMessung(messung, grenzeMs = MAX_UNSICHERHEIT_MS) {
  if (!messung || messung.widerspruch || !Number.isFinite(messung.abweichungMs) || !(messung.unsicherheitMs <= grenzeMs)) return null;
  return -Math.round(messung.abweichungMs) || 0; // keine negative Null
}
