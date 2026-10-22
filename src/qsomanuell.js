// QSO von Hand eintragen: Eingaben prüfen und daraus einen Log-Eintrag bauen (ohne Oberfläche, gut testbar).

const RUF = /^[A-Z0-9/]{3,}$/;
const LOC = /^[A-R]{2}\d{2}([A-X]{2})?$/;
const RAPPORT = /^[+-]\d{2}$/;
const VORLAUF_MS = 10 * 60_000; // die Uhr darf etwas vorgehen
const STANDARD_DAUER_MS = 120_000;
const TAG_MS = 86_400_000;
const MAX_UEBER_MITTERNACHT_MS = 30 * 60_000; // länger dauert kein QSO, alles darüber ist ein Tippfehler

const zwei = (n) => String(n).padStart(2, '0');

// Datum und Uhrzeit (UTC) zum Vorbelegen der Felder
export function datumZeitAusMs(ms) {
  const d = new Date(ms);
  return { datum: `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`, zeit: `${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}` };
}

function zeitpunkt(datum, uhr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const z = /^(\d{2}):(\d{2})$/.exec(uhr);
  if (!d || !z) return null;
  const [j, m, t, h, min] = [d[1], d[2], d[3], z[1], z[2]].map(Number);
  if (h > 23 || min > 59) return null;
  const ms = Date.UTC(j, m - 1, t, h, min);
  const probe = new Date(ms);
  return probe.getUTCFullYear() === j && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === t ? ms : null;
}

// felder: dxCall, dxGrid, rptSent, rptRcvd, confirmed, notiz, datum (JJJJ-MM-TT), von, bis (HH:MM, UTC)
// Rückgabe: { fehler: [Feldnamen], eintrag: Log-Eintrag oder null }
export function pruefeManuellesQso(felder, { meinCall, meinGrid, jetztMs }) {
  const fehler = [];
  const call = String(meinCall ?? '').trim().toUpperCase();
  if (!RUF.test(call)) fehler.push('meinCall');
  const dxCall = String(felder.dxCall ?? '').trim().toUpperCase();
  if (!RUF.test(dxCall)) fehler.push('dxCall');
  const grid = String(felder.dxGrid ?? '').trim().toUpperCase();
  if (grid && !LOC.test(grid)) fehler.push('dxGrid');
  const rapport = {};
  for (const k of ['rptSent', 'rptRcvd']) {
    const r = String(felder[k] ?? '').trim();
    if (r && !RAPPORT.test(r)) fehler.push(k);
    rapport[k] = r || null;
  }
  const datum = String(felder.datum ?? '').trim();
  const von = String(felder.von ?? '').trim();
  const bisText = String(felder.bis ?? '').trim();
  const tagOk = zeitpunkt(datum, '00:00') !== null;
  const start = tagOk ? zeitpunkt(datum, von) : null;
  let ende = null;
  if (!tagOk) fehler.push('datum');
  if (zeitpunkt('2000-01-01', von) === null) fehler.push('von');
  if (start !== null && start > jetztMs + VORLAUF_MS) fehler.push('datum');
  if (bisText) {
    ende = tagOk ? zeitpunkt(datum, bisText) : null;
    // Ende vor Beginn: nur über Mitternacht, wenn das Gespräch dann kurz bleibt
    if (ende !== null && start !== null && ende < start && ende + TAG_MS - start <= MAX_UEBER_MITTERNACHT_MS) ende += TAG_MS;
    if (tagOk && (ende === null || (start !== null && ende < start))) fehler.push('bis');
    if (!tagOk && zeitpunkt('2000-01-01', bisText) === null) fehler.push('bis');
  } else if (start !== null) ende = start + STANDARD_DAUER_MS;
  if (fehler.length) return { fehler, eintrag: null };
  return {
    fehler,
    eintrag: {
      myCall: call,
      myGrid: String(meinGrid ?? '').trim().toUpperCase() || null,
      dxCall,
      dxGrid: grid || null,
      rptSent: rapport.rptSent,
      rptRcvd: rapport.rptRcvd,
      confirmed: !!felder.confirmed,
      notiz: String(felder.notiz ?? '').trim().slice(0, 200) || null,
      startedAtMs: start,
      completedAtMs: ende,
      manuell: true,
    },
  };
}
