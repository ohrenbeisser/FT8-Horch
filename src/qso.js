// QSO-Ablauf mit Auto-Sequenz wie bei WSJT-X: Tx1 bis Tx6, ein QSO zur Zeit.
//
//   Tx1  <Gegenstelle> <ich> <Locator>      Antwort auf CQ
//   Tx2  <Gegenstelle> <ich> <Rapport>      Rapport senden
//   Tx3  <Gegenstelle> <ich> R<Rapport>     Rapport bestätigen und eigenen senden
//   Tx4  <Gegenstelle> <ich> RR73           Bestätigung
//   Tx5  <Gegenstelle> <ich> 73             Schlussgruß
//   Tx6  CQ <ich> <Locator>                 allgemeiner Anruf
//
// Das Modul kennt weder Audio noch Zeitfenster. Es bekommt decodierte Nachrichten (onDecoded), und die
// Steuerung (station.js) fragt zu Beginn jedes Sendefensters nach der nächsten Nachricht (nextTx).

const LOCATOR = /^[A-R]{2}\d{2}$/;
const RAPPORT = /^[+-]\d{2}$/;
const R_RAPPORT = /^R[+-]\d{2}$/;
// Rufzeichenform: Buchstaben, Ziffern und Schrägstrich, mindestens eine Ziffer und ein Buchstabe. Schließt Wörter wie TEST
// und Hash-Rufzeichen (<DL6LG>, Typ 4) aus.
export const istRufzeichen = (s) => /^[A-Z0-9/]{3,13}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s);

const CQ_ZUSATZ = /^(\d{3}|[A-Z]{1,4})$/;

// Zerlegt den Text einer Nachricht für die QSO-Logik
export function parseMessage(text) {
  const w = text.trim().toUpperCase().split(/\s+/);
  if (w[0] === 'CQ' && w.length >= 2) {
    let i = 1;
    let modifier = null;
    if (w.length >= 3 && CQ_ZUSATZ.test(w[1])) { modifier = w[1]; i = 2; }
    const grid = w[i + 1] && LOCATOR.test(w[i + 1]) ? w[i + 1] : null;
    if (w.length > i + 2 || (w[i + 1] && !grid)) return { kind: 'other' };
    if (!istRufzeichen(w[i]) || grid === 'RR73') return { kind: 'other' };
    return { kind: 'cq', de: w[i], grid, modifier };
  }
  if (w.length < 2 || w.length > 3 || w[0] === 'CQ' || w[0] === 'QRZ' || w[0] === 'DE') return { kind: 'other' };
  const [to, de, extra = ''] = w;
  if ((to !== '<...>' && !istRufzeichen(to)) || !istRufzeichen(de)) return { kind: 'other' };
  let type;
  let value = null;
  if (extra === '') type = 'none';
  else if (LOCATOR.test(extra) && extra !== 'RR73') type = 'grid';
  else if (extra === 'RR73') type = 'rr73';
  else if (extra === 'RRR') type = 'rrr';
  else if (extra === '73') type = '73';
  else if (RAPPORT.test(extra)) { type = 'report'; value = Number(extra); }
  else if (R_RAPPORT.test(extra)) { type = 'rreport'; value = Number(extra.slice(1)); }
  else return { kind: 'other' };
  return { kind: 'to', to, de, type, extra, value };
}

// Rapport für die Nachricht: auf ganze dB gerundet, -30 bis +32, immer mit Vorzeichen und zwei Stellen
export function formatReport(snrDb) {
  if (!Number.isFinite(snrDb)) return '-10';
  const r = Math.max(-30, Math.min(32, Math.round(snrDb)));
  return `${r < 0 ? '-' : '+'}${String(Math.abs(r)).padStart(2, '0')}`;
}

export class Qso {
  // optionen: myCall, myGrid, maxRetries (Wiederholungen ohne Fortschritt), rr73Repeats (Wiederholungen von
  // RR73 ohne 73), now (Uhr in ms), cqWeiter() (ja: nach einem QSO aus dem eigenen CQ weiter CQ rufen), onComplete(record), onChange(qso)
  constructor({ myCall, myGrid, maxRetries = 5, rr73Repeats = 3, now = () => Date.now(), cqWeiter = () => false, onComplete = null, onChange = null } = {}) {
    if (!myCall || !/^[A-Z0-9/]{3,}$/i.test(myCall)) throw new RangeError('Rufzeichen fehlt oder ist ungültig');
    if (!LOCATOR.test(String(myGrid).toUpperCase())) throw new RangeError(`Ungültiger Locator ${myGrid}`);
    this.myCall = myCall.toUpperCase();
    this.myGrid = myGrid.toUpperCase();
    this.maxRetries = maxRetries;
    this.rr73Repeats = rr73Repeats;
    this.now = now;
    this.cqWeiter = cqWeiter;
    this.onComplete = onComplete;
    this.onChange = onChange;
    this.#zuruecksetzen();
  }

  #zuruecksetzen() {
    this.state = 'idle'; // idle, cq, qso, closing (letztes 73 steht noch aus)
    this.tx = 0; // nächste Nachricht (1 bis 6), 0 = keine
    this.txParity = null;
    this.dxCall = null;
    this.dxGrid = null;
    this.snrDx = NaN;
    this.rptRcvd = null;
    this.rptSent = null;
    this.rptOnAir = false; // ein Rapport wurde schon gesendet
    this.retries = 0;
    this.rr73Count = 0;
    this.wasCq = false;
    this.startedAtMs = null;
    this.completed = false;
  }

  get active() {
    return this.state !== 'idle';
  }

  #aenderung() {
    this.onChange?.(this);
  }

  // Ich rufe CQ im Fenster mit der Parität 'even' oder 'odd'
  startCq(parity) {
    if (parity !== 'even' && parity !== 'odd') throw new RangeError(`Parität muss even oder odd sein, war ${parity}`);
    this.#zuruecksetzen();
    this.state = 'cq';
    this.tx = 6;
    this.txParity = parity;
    this.wasCq = true;
    this.#aenderung();
  }

  // Ich antworte auf ein CQ. cq: { de, grid, parity (der Anrufer), snrDb }
  answer(cq) {
    this.#zuruecksetzen();
    this.state = 'qso';
    this.dxCall = cq.de.toUpperCase();
    this.dxGrid = cq.grid ?? null;
    this.snrDx = cq.snrDb ?? NaN;
    this.tx = 1;
    this.txParity = cq.parity === 'even' ? 'odd' : 'even';
    this.startedAtMs = this.now();
    this.#aenderung();
  }

  halt() {
    this.#zuruecksetzen();
    this.#aenderung();
  }

  // Ende eines QSO: im Leerlauf anhalten oder, wenn gewünscht und das QSO aus dem eigenen CQ entstand, wieder CQ rufen
  #beenden() {
    const weiter = this.wasCq && this.txParity && this.cqWeiter();
    const lage = this.txParity;
    this.#zuruecksetzen();
    if (weiter) this.startCq(lage);
  }

  #text(n) {
    const du = `${this.dxCall} ${this.myCall}`;
    switch (n) {
      case 1: return `${du} ${this.myGrid}`;
      case 2: return `${du} ${formatReport(this.snrDx)}`;
      case 3: return `${du} R${formatReport(this.snrDx)}`;
      case 4: return `${du} RR73`;
      case 5: return `${du} 73`;
      default: return `CQ ${this.myCall} ${this.myGrid}`;
    }
  }

  // Wird zu Beginn jedes Sendefensters aufgerufen. Liefert die zu sendende Nachricht oder null.
  nextTx() {
    if (this.state === 'idle' || this.tx === 0) return null;
    const n = this.tx;

    if (n === 6) return { n, text: this.#text(6) };

    if (n === 4) {
      if (this.rr73Count >= this.rr73Repeats) { // keine 73 gehört: unbestätigt abschließen
        this.#abschliessen(false);
        this.#beenden();
        this.#aenderung();
        return null;
      }
      this.rr73Count++;
    } else if (n !== 5) {
      if (this.retries >= this.maxRetries) { // aufgegeben
        this.#beenden();
        this.#aenderung();
        return null;
      }
      this.retries++;
    }

    if (n === 2 || n === 3) {
      this.rptSent = formatReport(this.snrDx);
      this.rptOnAir = true;
    }
    const nachricht = { n, text: this.#text(n) };
    if (n === 5) { // Schlussgruß wird nur einmal gesendet
      this.#beenden();
      this.#aenderung();
    }
    return nachricht;
  }

  #abschliessen(bestaetigt) {
    if (this.completed) return;
    this.completed = true;
    this.onComplete?.({
      myCall: this.myCall,
      myGrid: this.myGrid,
      dxCall: this.dxCall,
      dxGrid: this.dxGrid,
      rptSent: this.rptSent,
      rptRcvd: this.rptRcvd,
      confirmed: bestaetigt,
      wasCq: this.wasCq,
      startedAtMs: this.startedAtMs,
      completedAtMs: this.now(),
    });
  }

  // Verarbeitet die decodierten Nachrichten eines Fensters: { text, snrDb, f0, parity }, in der Reihenfolge der Liste
  onDecoded(nachrichten) {
    for (const n of nachrichten) {
      const m = parseMessage(n.text);
      if (m.kind !== 'to' || m.to !== this.myCall) continue;
      if (this.state === 'idle' || this.state === 'closing') continue;

      if (this.state === 'cq') { // jemand antwortet auf meinen Anruf
        if (m.type === 'grid' || m.type === 'report') {
          this.state = 'qso';
          this.dxCall = m.de;
          this.dxGrid = m.type === 'grid' ? m.extra : null;
          this.startedAtMs = this.now();
          this.snrDx = n.snrDb;
          this.tx = 2;
          this.retries = 0;
          this.#aenderung();
        }
        continue;
      }

      if (m.de !== this.dxCall) continue; // ein anderer Anrufer, ein QSO zur Zeit
      this.snrDx = Number.isFinite(n.snrDb) ? n.snrDb : this.snrDx;

      switch (m.type) {
        case 'grid':
          if (this.tx === 2 || this.tx === 1) { this.dxGrid ??= m.extra; this.retries = 0; }
          break;
        case 'report': // Tx2 der Gegenstelle: sie hat meinen Anruf gehört
          this.rptRcvd = formatReport(m.value);
          if (this.tx === 1 || this.tx === 2) this.tx = 3;
          this.retries = 0;
          break;
        case 'rreport': // Tx3 der Gegenstelle
          this.rptRcvd = formatReport(m.value);
          this.tx = this.rptOnAir ? 4 : 3;
          this.retries = 0;
          this.rr73Count = 0;
          break;
        case 'rr73':
        case 'rrr': // Tx4: QSO ist bestätigt, noch ein 73 senden
          this.#abschliessen(true);
          this.state = 'closing';
          this.tx = 5;
          break;
        case '73': // Tx5: fertig
          this.#abschliessen(true);
          this.#beenden();
          break;
        default:
          break;
      }
      this.#aenderung();
    }
  }
}
