// QSO-Ansicht: Mikrofon, Wasserfall, Band-Aktivität, QSO-Fenster.
import { AudioIn } from './src/audio-in.js';
import { AudioOut } from './src/audio-out.js';
import { Spectrogram } from './src/spectrum.js';
import { Waterfall } from './src/waterfall.js';
import { WakeLock } from './src/wakelock.js';
import { checkProfile } from './src/profile.js';
import { encodeMessage } from './src/encoder.js';
import { renderSlot } from './src/gfsk.js';
import { DecoderClient } from './src/decoder-client.js';
import { Qso, parseMessage } from './src/qso.js';
import { Station } from './src/station.js';
import { waehleAntwort } from './src/autoantwort.js';
import { einstellung, setzeEinstellung } from './src/settings.js';
import { t } from './src/i18n.js';

const $ = (id) => document.getElementById(id);
export const hms = (ms) => new Date(ms).toISOString().slice(11, 19);

export function erzeugeQsoAnsicht({ uhr, profil, beiLog, beiProtokoll = () => {}, beiCodierung = () => {}, eintraege = async () => [], meldung }) {
  const sperre = new WakeLock();
  const ausgabe = new AudioOut({ jetzt: () => uhr.now() });
  const decoder = new DecoderClient();
  const spektrum = new Spectrogram({ fftSize: 4096, hop: 1024 });
  let station = null;
  let letzterSlot = null;
  const decodeMs = { 0: null, 1: null }; // letzte Rechenzeit je Durchgang (0 früh, 1 Fensterende)
  let letzterStatus = null;
  const parWert = () => ($('par').getAttribute('aria-checked') === 'true' ? 'odd' : 'even');
  $('par').addEventListener('click', () => $('par').setAttribute('aria-checked', String(parWert() === 'even')));
  const ms4 = (wert) => (wert === null ? '   –' : String(Math.round(wert)).padStart(4)); // Rechenzeit in ms, vierstellig
  let mikAn = false;
  const hoerer = new Set(); // Funktionen, die die Decodierungen der Station mitlesen (Verbindungstest im Labor)
  let fremdSperre = () => null; // liefert einen Text, solange etwas anderes die Station braucht (Verbindungstest)

  // knopf: { symbol, titel, aktion } hängt einen kleinen Symbolknopf an die Zeile
  function zeile(ziel, text, klasse = '', klick = null, knopf = null) {
    const el = document.createElement('div');
    if (klasse) el.className = klasse;
    if (klick) el.addEventListener('click', klick);
    if (knopf) {
      el.classList.add('mitknopf');
      const t = document.createElement('span');
      t.textContent = text;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn klein';
      b.title = knopf.titel;
      b.setAttribute('aria-label', knopf.titel);
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${knopf.symbol}"/></svg>`;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); knopf.aktion(); });
      el.append(t, b);
    } else el.textContent = text;
    const l = $(ziel);
    // Neue Zeilen kommen unten dazu (wie in WSJT-X), der Inhalt rutscht nach oben. Wer nach oben gescrollt hat, bleibt dort.
    const amEnde = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
    l.append(el);
    while (l.children.length > 200) l.firstChild.remove();
    if (amEnde) l.scrollTop = l.scrollHeight;
  }

  // Sendefrequenz beim Antworten: die der Gegenstelle (und in den Einstellungen merken) oder, bei „halten“, die eigene (NaN = nicht ändern)
  function antwortFrequenz(f0) {
    if (einstellung('txHalten') === 1) return NaN;
    setzeEinstellung('txf', Math.round(f0));
    return f0;
  }

  const meinCall = () => einstellung('call').trim().toUpperCase();

  function bauStation() {
    station?.halt();
    station = null;
    try {
      const qso = new Qso({
        myCall: meinCall(), myGrid: einstellung('grid').trim().toUpperCase(), now: () => uhr.now(), cqWeiter: () => einstellung('cqWeiter') === 1,
        onComplete: (r) => { logCalls.add(r.dxCall); beiLog(r); },
      });
      $('warnung').textContent = '';
      station = new Station({
        qso, profile: profil(), clock: uhr, recorder: mik.recorder,
        decode: async (samples, p, { durchgang, ...opt }) => { const r = await decoder.decode(samples, p, { ...opt, zwischenwerte: true }); decodeMs[durchgang] = r.ms; return r; },
        encode: (text, p) => renderSlot(encodeMessage(text).tones, p),
        play: (samples, rate, startMs, maxSpaetSec) => ausgabe.play(samples, rate, startMs, maxSpaetSec),
        onEvent: ereignis,
      });
      station.setTxF0(profil().f0);
    } catch (e) {
      station = null;
      $('warnung').textContent = t('settings.invalid', { msg: e.message });
    }
  }

  // Zusatz für die Meldung nach einer Antwort: wann die App tatsächlich sendet (bei einem spät gefundenen CQ erst im übernächsten Fenster)
  const sendezeit = () => {
    const start = station.naechsterSendeStart(uhr.now());
    return t('qso.sendsAt', { time: hms(start), sec: Math.max(0, Math.round((start - uhr.now()) / 1000)) });
  };

  // Rufzeichen aus dem Log, für die grüne Markierung in der Band-Aktivität (wird höchstens alle 5 s aufgefrischt)
  let logCalls = new Set();
  let logGeladen = 0;
  async function ladeLogCalls() {
    logGeladen = Date.now();
    try { logCalls = new Set((await eintraege()).map((x) => x.dxCall)); } catch { /* ohne Log keine Markierung */ }
  }
  ladeLogCalls();

  // Auto-Antwort: nach dem frühen Durchgang auf das erste passende CQ antworten, wenn gerade kein QSO läuft.
  // Der späte Durchgang (15,05 s) käme zu spät für das nächste Sendefenster.
  let autoBusy = false;
  const autoAn = () => $('autoAntwort').getAttribute('aria-checked') === 'true';
  $('autoAntwort').addEventListener('click', () => $('autoAntwort').setAttribute('aria-checked', String(!autoAn())));
  async function autoAntworten(e) {
    if (autoBusy || !station || !mikAn || fremdSperre()) return;
    if (station.qso.state !== 'idle') {
      if (e.signals.some((x) => parseMessage(x.text).kind === 'cq')) zeile('qso', t('qso.autoBusy', { state: t(`qso.state.${station.qso.state}`, { dx: station.qso.dxCall ?? '' }) }), 'info');
      return;
    }
    autoBusy = true;
    try {
      let liste = [];
      try { liste = await eintraege(); } catch { /* ohne Log wird nichts übersprungen */ }
      if (!autoAn() || !station || station.qso.state !== 'idle') return;
      const w = waehleAntwort(e.signals, { meinCall: meinCall(), eintraege: liste, modus: einstellung('autoSkip'), jetztMs: uhr.now() });
      if (!w) return;
      station.answer({ de: w.cq.de, grid: w.cq.grid, parity: e.parity, snrDb: w.signal.snrDb, f0: antwortFrequenz(w.signal.f0) });
      aktualisiereMarken();
      zeile('qso', t('qso.autoAnswer', { call: w.cq.de, f: Math.round(w.signal.f0) }) + sendezeit(), 'info');
    } finally { autoBusy = false; }
  }

  let txSlot = null; // Fenster, dessen Sendung die Statuszeile gerade zeigt
  let sendeText = ''; // Nachricht, die gerade gesendet wird (leer, wenn nicht gesendet wird)

  function ereignis(e) {
    if (e.type === 'decoded') {
      for (const h of hoerer) h(e);
      if (Date.now() - logGeladen > 5000) ladeLogCalls();
      for (const s of e.signals) {
        const m = parseMessage(s.text);
        const anMich = m.kind === 'to' && m.to === meinCall();
        const text = `${hms(e.slotStartMs)} ${String(Math.round(s.snrDb)).padStart(3)} dB ${s.dtSec.toFixed(1).padStart(4)} ${String(Math.round(s.f0)).padStart(4)}  ${s.text}`;
        const imLog = (m.kind === 'cq' || m.kind === 'to') && logCalls.has(m.de);
        const klick = m.kind === 'cq' && station
          ? () => {
            if (fremdSperre()) { meldung(fremdSperre()); return; }
            station.answer({ de: m.de, grid: m.grid, parity: e.parity, snrDb: s.snrDb, f0: antwortFrequenz(s.f0) });
            aktualisiereMarken();
            zeile('qso', t('qso.answerTo', { call: m.de, f: Math.round(s.f0) }) + sendezeit(), 'info');
          }
          : null;
        beiProtokoll({ typ: 'rx', ms: e.slotStartMs, parity: e.parity, snr: s.snrDb, dt: s.dtSec, f0: s.f0, text: s.text });
        const knopf = s.zw ? { symbol: 'code', titel: t('qso.viewCoding'), aktion: () => beiCodierung({ zw: s.zw, zeitMs: e.slotStartMs, parity: e.parity }) } : null;
        zeile('band', e.pass === 1 ? `${text}  (${t('qso.passLate')})` : text, anMich ? 'anmich' : [m.kind === 'cq' ? 'cq' : '', imLog ? 'imlog' : ''].filter(Boolean).join(' '), klick, knopf);
        if (anMich) zeile('qso', `← ${hms(e.slotStartMs)} ${String(Math.round(s.snrDb)).padStart(3)} dB  ${s.text}`, 'anmich', null, knopf);
      }
      if (autoAn() && e.pass === 0) autoAntworten(e);
      else if (autoAn() && e.pass === 1 && station?.qso.state === 'idle' && e.signals.some((x) => parseMessage(x.text).kind === 'cq')) zeile('qso', t('qso.autoLate'), 'info');
      for (const u of e.unsupported) zeile('band', `${hms(e.slotStartMs)}        ${Math.round(u.f0)}  (${t('qso.unsupported')})`, 'info');
    } else if (e.type === 'tx') {
      const spaet = e.lateMs > 50 ? ` (${t('qso.late', { sec: (e.lateMs / 1000).toFixed(1) })})` : '';
      beiProtokoll({ typ: 'tx', ms: e.slotStartMs, parity: e.slotIndex % 2 === 0 ? 'even' : 'odd', f0: e.f0, text: e.text, n: e.n });
      sendeText = e.text;
      txSlot = e.slotIndex;
      zeile('qso', `→ ${hms(e.slotStartMs)} Tx${e.n} ${Math.round(e.f0)} Hz${spaet}  ${e.text}`, 'tx');
    } else if (e.type === 'txend') {
      if (e.slotIndex === txSlot) sendeText = '';
    } else if (e.type === 'error') {
      zeile('qso', t('qso.error', { msg: e.error?.message ?? e.error }), 'info');
    }
  }

  const wf = new Waterfall($('wf'), $('ov'), {
    fMin: 300, fMax: 3500,
    onTap: (f) => { setzeEinstellung('txf', Math.round(f)); aktualisiereMarken(); },
  });

  // Marken im Wasserfall, Profilprüfung und Hinweise
  function aktualisiereMarken() {
    const p = profil();
    wf.setMarkers({ tx: p.f0, profil: p });
    station?.setTxF0(p.f0);
  }

  const mik = new AudioIn({
    jetzt: () => uhr.now(),
    versatz: () => uhr.offsetMs,
    onBlock: ({ samples, peak, clipped }) => {
      const db = 20 * Math.log10(peak + 1e-6);
      $('pegel').style.width = `${Math.min(100, Math.max(0, ((db + 60) / 60) * 100))}%`;
      $('pegel').classList.toggle('uebersteuert', !!clipped);
      const s = uhr.slot(profil());
      const wechsel = letzterSlot !== null && s.index !== letzterSlot;
      letzterSlot = s.index;
      let erste = true;
      for (const z of spektrum.push(samples)) {
        wf.addRow(z, spektrum.binHz, { slotStart: wechsel && erste });
        erste = false;
      }
    },
  });

  // Schalter und Zustand des Mikrofons abgleichen
  function zeigeMik(an, gesperrt = false) {
    mikAn = an;
    $('btnMik').setAttribute('aria-checked', String(an));
    $('btnMik').disabled = gesperrt;
    $('btnCq').disabled = !an;
    $('autoAntwort').disabled = !an; // die Wahl bleibt erhalten, auch wenn das Mikrofon aus ist
  }

  // Mikrofon und Ausgabe starten (Nutzeraktion nötig). Wird von der QSO-Ansicht und vom Labor genutzt.
  async function starteAudio() {
    if (mikAn) return mik.info;
    zeigeMik(false, true);
    try {
      const info = await mik.start({ raw: true });
      await sperre.halten();
      await ausgabe.start();
      zeigeMik(true);
      const roh = !info.einstellungen.echoCancellation && !info.einstellungen.noiseSuppression && !info.einstellungen.autoGainControl;
      zeile('qso', t('qso.micInfo', { label: info.label || '', rate: info.rate, raw: roh }), 'info');
      return info;
    } catch (e) {
      await mik.stop();
      zeigeMik(false);
      throw e;
    }
  }

  // Mikrofon aus: laufendes QSO anhalten, Aufnahme beenden, Display wieder freigeben
  async function stoppeAudio() {
    if (!mikAn) return;
    zeigeMik(true, true);
    station?.halt();
    await mik.stop();
    await sperre.freigeben();
    $('pegel').style.width = '0%';
    letzterSlot = null;
    sendeText = '';
    zeigeMik(false);
    zeile('qso', t('qso.micOff'), 'info');
  }

  $('btnMik').addEventListener('click', async () => {
    try {
      if (mikAn) await stoppeAudio(); else await starteAudio();
    } catch (e) { zeile('qso', t('qso.micError', { msg: `${e.name}: ${e.message}` }), 'info'); }
  });

  $('btnCq').addEventListener('click', async () => {
    if (!mikAn) { meldung(t('qso.needMic')); return; }
    if (fremdSperre()) { meldung(fremdSperre()); return; }
    if (!station) bauStation();
    if (!station) { meldung($('warnung').textContent); return; }
    await ausgabe.start();
    station.startCq(parWert());
    zeile('qso', t('qso.cqStarted', { parity: t(parWert() === 'even' ? 'qso.even' : 'qso.odd') }), 'info');
  });
  $('btnHalt').addEventListener('click', () => { station?.halt(); zeile('qso', t('qso.halted'), 'info'); });

  // Alle 100 ms: Statuszeile und Stationstakt
  setInterval(() => {
    const s = uhr.slot(profil());
    const stellen = String(Math.floor(profil().slotSec)).length; // Restzeit mit führenden Nullen, damit der Text nicht springt
    const rest = s.remainingSec.toFixed(1).padStart(stellen + 2, '0');
    let neu = `[${s.parity === 'even' ? '|' : '/'} ${rest}s]`;
    if (!mikAn) neu += ` ${t('qso.micOffHint')}`;
    else {
      if (station) {
        const q = station.qso;
        const nr = (q.state === 'qso' || q.state === 'closing') && q.tx ? ` Tx${q.tx}` : '';
        neu += ` ${t('qso.stateLine', { state: t(`qso.state.${q.state}`, { dx: q.dxCall ?? '' }) + nr })}`;
      }
      neu += ` [${ms4(decodeMs[0])}/${ms4(decodeMs[1])}ms]`;
      if (sendeText) neu += ` ${sendeText}`;
    }
    $('btnHalt').disabled = !(mikAn && station && station.qso.state !== 'idle'); // Stop nur bei CQ oder QSO
    if (neu !== letzterStatus) { $('status').textContent = neu; letzterStatus = neu; }
    station?.tick();
  }, 100);

  bauStation();
  aktualisiereMarken();
  return {
    neuBauen() { bauStation(); aktualisiereMarken(); },
    profilGeaendert() { station?.setProfile(profil()); aktualisiereMarken(); },
    checkProfile: () => checkProfile(profil()),
    audio: { mik, ausgabe, starte: starteAudio },
    abonniere(fn) { hoerer.add(fn); return () => hoerer.delete(fn); },
    setzeSperre(fn) { fremdSperre = fn; },
    station: () => station,
    qsoAktiv: () => !!station && station.qso.state !== 'idle',
    mikLaeuft: () => mikAn,
    debug: { get station() { return station; }, mik, decoder, wf, zeigeMik, decodeMs }, // zeigeMik und decodeMs: für die Bilder der Anleitung
  };
}
