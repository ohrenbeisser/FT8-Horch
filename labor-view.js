// Labor-Tab: Pegeltest, Laufzeitmessung (später Simulator). Alles läuft über das Mikrofon und die Ausgabe der QSO-Ansicht.
import { erzeugeTestton, wertePegeltestAus } from './src/pegel.js';
import { erzeugeChirp, findeChirp, statistik } from './src/laufzeit.js';
import { SAMPLE_RATE, VORLAUF_JE_KT_SEC, createProfile } from './src/profile.js';
import { DecoderClient } from './src/decoder-client.js';
import { leseAudiodatei, dateinameAufnahme, leseDateiname, lageImFenster, maxDateiSec } from './src/wavdatei.js';
import { encodeWav } from './src/wav.js';
import { slotInfo } from './src/clock.js';
import { Verbindungstest, ergebnisAlsText, MIN_RUNDEN, MAX_RUNDEN } from './src/verbindungstest.js';
import { encodeMessage } from './src/encoder.js';
import { renderSlot } from './src/gfsk.js';
import { einstellung, setzeEinstellung } from './src/settings.js';
import { herunterladen } from './src/herunterladen.js';
import { SimulatorClient } from './src/simulator-client.js';
import { laufeReihe, schwelle50, standardBereich, snrListe } from './src/simulator.js';
import { t, zahl } from './src/i18n.js';

const $ = (id) => document.getElementById(id);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const vorz = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
const dbText = (x) => `${x <= -119 ? '< −120' : vorz(x) + zahl(Math.abs(x), 0)} dB`;
const ms0 = (x) => `${vorz(Math.round(x))}${zahl(Math.abs(Math.round(x)), 0)} ms`;

function zeile(ziel, beschriftung, wert, klasse = '') {
  const d = document.createElement('div');
  d.className = `messzeile ${klasse}`.trim();
  const a = document.createElement('span');
  a.textContent = beschriftung;
  const b = document.createElement('span');
  b.className = 'mono';
  b.textContent = wert;
  d.append(a, b);
  ziel.append(d);
}

function urteilBox(ziel, art, text) {
  const d = document.createElement('div');
  d.className = `urteil ${art}`;
  d.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${art === 'ok' ? 'check' : 'warning'}"/></svg>`;
  const s = document.createElement('span');
  s.textContent = text;
  d.append(s);
  ziel.append(d);
}

export function erzeugeLaborAnsicht({ audio, qsoAktiv, abonniere = () => () => {}, station = () => null, meldung, profil, jetzt = () => Date.now(), beiCodierung = () => {} }) {
  let laeuft = false;

  // Wartet, bis der Aufnahmepuffer den absoluten Index erreicht hat
  async function warteAufIndex(ring, ziel, maxMs = 6000) {
    const ende = Date.now() + maxMs;
    while (ring.total < ziel) {
      if (Date.now() > ende) throw new Error(t('lab.noMicData'));
      await warte(40);
    }
  }

  async function vorbereiten(knopf, status) {
    if (laeuft) return false;
    if (qsoAktiv()) { meldung(t('lab.qsoActive')); return false; }
    laeuft = true;
    knopf.disabled = true;
    try {
      status.textContent = t('lab.startingAudio');
      await audio.starte();
    } catch (e) {
      status.textContent = t('qso.micError', { msg: `${e.name}: ${e.message}` });
      laeuft = false; knopf.disabled = false;
      return false;
    }
    return true;
  }

  // ----------------------------------------------------------------------------------------
  async function pegeltest() {
    const status = $('pegelStatus');
    const aus = $('pegelErgebnis');
    aus.replaceChildren();
    if (!(await vorbereiten($('btnPegel'), status))) return;
    try {
      const ring = audio.mik.recorder.ring;
      const f = 1500;
      status.textContent = t('lab.level.silence');
      const i0 = ring.total + Math.round(0.3 * SAMPLE_RATE);
      await warteAufIndex(ring, i0 + 2 * SAMPLE_RATE);
      const stille = ring.read(i0, 2 * SAMPLE_RATE);

      status.textContent = t('lab.level.tone');
      const i1 = ring.total;
      const spur = await audio.ausgabe.play(erzeugeTestton({ rate: SAMPLE_RATE, f, dauerSec: 3.5, amp: 0.5 }), SAMPLE_RATE, null);
      await warteAufIndex(ring, i1 + Math.round(3.4 * SAMPLE_RATE));
      const ton = ring.read(i1 + Math.round(0.8 * SAMPLE_RATE), 2 * SAMPLE_RATE);
      spur.stop();
      if (!stille || !ton) throw new Error(t('lab.incomplete'));

      const r = wertePegeltestAus({ stille, ton, rate: SAMPLE_RATE, f });
      status.textContent = '';
      zeile(aus, t('lab.level.noise'), `${dbText(r.rauschRmsDb)}FS`);
      zeile(aus, t('lab.level.toneLevel', { f }), `${dbText(r.tonDb)}FS`);
      zeile(aus, t('lab.level.peak'), `${dbText(r.peakDb)}FS${r.clippedAnzahl ? ` (${r.clippedAnzahl} ${t('lab.level.clipped')})` : ''}`);
      if (r.tonGehoert) zeile(aus, t('lab.level.snr'), `${zahl(r.snr2500Db, 0)} dB`);
      urteilBox(aus, r.urteil === 'gut' ? 'ok' : 'warn', t(`lab.level.verdict.${r.urteil}`));
    } catch (e) {
      status.textContent = t('lab.failed', { msg: e.message });
    } finally {
      laeuft = false;
      $('btnPegel').disabled = false;
    }
  }

  // ----------------------------------------------------------------------------------------
  const WIEDERHOLUNGEN = 5;

  async function laufzeit() {
    const status = $('latStatus');
    const aus = $('latErgebnis');
    aus.replaceChildren();
    if (!(await vorbereiten($('btnLat'), status))) return;
    try {
      const rec = audio.mik.recorder;
      const chirp = erzeugeChirp({ rate: SAMPLE_RATE });
      const werte = [];
      const einzel = [];
      for (let k = 1; k <= WIEDERHOLUNGEN; k++) {
        status.textContent = t('lab.lat.running', { k, n: WIEDERHOLUNGEN });
        const geplant = jetzt() + 800; // so früh soll der Ton im Lautsprecher hörbar sein (Zeit der App-Uhr)
        const spur = await audio.ausgabe.play(chirp, SAMPLE_RATE, geplant);
        const vonMs = geplant - 400;
        const i0 = rec.indexAt(vonMs);
        const len = Math.round(1.4 * SAMPLE_RATE);
        await warteAufIndex(rec.ring, i0 + len);
        const x = rec.ring.read(i0, len);
        spur.stop();
        const r = x ? findeChirp(x, chirp) : null;
        if (r) {
          const d = rec.utcAt(i0 + r.index) - geplant;
          werte.push(d);
          einzel.push(`${k}: ${ms0(d)}`);
        } else einzel.push(`${k}: ${t('lab.lat.notFound')}`);
        await warte(300);
      }
      status.textContent = '';
      const s = statistik(werte);
      if (!s.n) {
        urteilBox(aus, 'warn', t('lab.lat.none'));
      } else {
        zeile(aus, t('lab.lat.median'), ms0(s.medianMs));
        zeile(aus, t('lab.lat.spread'), `± ${zahl(Math.round(s.streuungMs), 0)} ms`);
        zeile(aus, t('lab.lat.valid'), `${s.n} / ${WIEDERHOLUNGEN}`);
        zeile(aus, t('lab.lat.single'), einzel.join('   '));
        zeile(aus, t('lab.lat.reported'), `${t('lab.lat.out')} ${ms0(audio.ausgabe.latencySec * 1000).replace('+', '')}${audio.ausgabe.zusatzSec > 0 ? ` (${t('lab.lat.extra')} ${ms0(audio.ausgabe.zusatzSec * 1000).replace('+', '')})` : ''}, ${t('lab.lat.in')} ${ms0(audio.mik.eingangsLatenzMs).replace('+', '')}, ${t('lab.lat.filter')} ${ms0(audio.mik.verzoegerungMs).replace('+', '')}`);
        const betrag = Math.abs(s.medianMs);
        const unsicher = s.n < 3 || s.streuungMs > 60;
        const art = betrag <= 100 ? 'ok' : betrag <= 500 ? 'mid' : 'bad';
        urteilBox(aus, art === 'ok' && !unsicher ? 'ok' : 'warn', `${t(`lab.lat.verdict.${art}`)}${unsicher ? ` ${t('lab.lat.unsure')}` : ''}`);
      }
    } catch (e) {
      status.textContent = t('lab.failed', { msg: e.message });
    } finally {
      laeuft = false;
      $('btnLat').disabled = false;
    }
  }

  // ----------------------------------------------------------------------------------------
  // Simulator
  let simulator = null;
  const versuchImWorker = (p) => (simulator ??= new SimulatorClient()).versuch(p);
  let bereichVonHand = false;
  const msProKt = {}; // gemessene Rechenzeit je Versuch und Zeitfaktor
  const SCHAETZ_MS = { 1: 600, 2: 1500, 4: 3500, 8: 9000 }; // grob: PC-Werte (E5b) mal drei bis fünf für ein Handy
  const feldZahl = (id) => Number($(id).value);

  function basisParameter() {
    const p = profil();
    return {
      text: $('simText').value, kf: p.kf, f0: p.f0, dtSec: feldZahl('simDt'),
      freqVersatzHz: feldZahl('simDf'), taktPpm: feldZahl('simPpm'),
    };
  }

  const dauerText = (ms) => (ms < 90000 ? t('sim.seconds', { s: Math.max(1, Math.round(ms / 1000)) }) : t('sim.minutes', { m: Math.round(ms / 60000) }));

  function reihenPlan() {
    const p = profil();
    const ktListe = $('reiheWelche').value === 'alle' ? [1, 2, 4, 8] : [p.kt];
    const versuche = Math.max(1, Math.min(50, Math.round(feldZahl('reiheN')) || 1));
    return ktListe.map((kt) => {
      const bereich = ktListe.length > 1 ? standardBereich(kt) : { vonDb: feldZahl('reiheVon'), bisDb: feldZahl('reiheBis'), schrittDb: feldZahl('reiheSchritt') || 2 };
      return { kt, versuche, liste: snrListe(bereich) };
    });
  }

  function zeigeSchaetzung() {
    const plan = reihenPlan();
    const n = plan.reduce((s, x) => s + x.liste.length * x.versuche, 0);
    const ms = plan.reduce((s, x) => s + x.liste.length * x.versuche * (msProKt[x.kt] ?? SCHAETZ_MS[x.kt]), 0);
    $('reiheSchaetzung').textContent = t('sim.estimate', { n, time: dauerText(ms) });
  }

  function fuelleBereich() {
    const p = profil();
    $('simProfil').textContent = t('sim.profileNote', { profile: p.standard ? `FT8 (${p.slotSec} s)` : `${t('profile.variant')} (${p.slotSec} s, ${zahl(p.toneSpacing)} Hz)` });
    if (!bereichVonHand) {
      const b = standardBereich(p.kt);
      $('reiheVon').value = b.vonDb;
      $('reiheBis').value = b.bisDb;
    }
    zeigeSchaetzung();
  }

  async function einzelversuch() {
    const aus = $('simErgebnis');
    aus.replaceChildren();
    if (laeuft) return;
    laeuft = true;
    $('btnSimEin').disabled = true;
    $('simStatus').textContent = t('sim.running');
    try {
      const p = profil();
      const r = await versuchImWorker({ ...basisParameter(), kt: p.kt, snrDb: feldZahl('simSnr'), seed: Date.now() % 100000 });
      $('simStatus').textContent = '';
      urteilBox(aus, r.ok ? 'ok' : 'warn', r.ok ? t('sim.result.decoded', { text: r.text }) : r.falsch ? t('sim.result.wrong', { text: r.text }) : t('sim.result.missed'));
      if (r.ok) {
        zeile(aus, t('sim.result.dt'), `${vorz(r.dtSec)}${zahl(Math.abs(r.dtSec), 2)} s`);
        zeile(aus, t('sim.result.f'), `${zahl(r.f0, 1)} Hz`);
        zeile(aus, t('sim.result.snr'), `${zahl(r.snrGeschaetztDb, 0)} dB`);
      }
      zeile(aus, t('sim.result.signals'), String(r.signale));
      zeile(aus, t('sim.result.ms'), `${zahl(Math.round(r.ms), 0)} ms`);
      msProKt[p.kt] = r.ms;
      if (r.zw) {
        const knopf = document.createElement('button');
        knopf.type = 'button'; knopf.className = 'btn tonal'; knopf.style.marginTop = '12px';
        knopf.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-code"/></svg>';
        const s = document.createElement('span'); s.textContent = t('qso.viewCoding'); knopf.append(s);
        knopf.addEventListener('click', () => beiCodierung({ zw: r.zw, zeitMs: null, parity: null }));
        aus.append(knopf);
      }
    } catch (e) {
      $('simStatus').textContent = t('sim.badInput', { msg: e.message });
    } finally {
      laeuft = false;
      $('btnSimEin').disabled = false;
    }
  }

  // Diagramm: Erfolgsrate über dem Rauschabstand, je Zeitfaktor eine Linie mit eigener Markerform und Beschriftung
  const MARKER = ['kreis', 'quadrat', 'dreieck', 'raute'];
  function marker(g, form, x, y, r) {
    g.beginPath();
    if (form === 'kreis') g.arc(x, y, r, 0, 2 * Math.PI);
    else if (form === 'quadrat') g.rect(x - r, y - r, 2 * r, 2 * r);
    else if (form === 'dreieck') { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y + r); g.lineTo(x - r - 1, y + r); g.closePath(); }
    else { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); }
    g.fill();
  }

  function zeichneDiagramm(serien) {
    const cv = $('reiheBild');
    cv.hidden = false;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(280, Math.round(cv.getBoundingClientRect().width)), H = 280; // Zeichenfläche in CSS-Pixeln, Größe nach Bildschirm
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const stil = getComputedStyle(document.documentElement);
    const farbe = (n) => stil.getPropertyValue(n).trim();
    const L = 44, R = 12, T = 30, B = 44;
    g.clearRect(0, 0, W, H);
    const alle = serien.flatMap((s) => s.punkte.map((p) => p.snrDb));
    if (!alle.length) return;
    const xMin = Math.floor(Math.min(...alle)) - 1, xMax = Math.ceil(Math.max(...alle)) + 1;
    const X = (v) => L + ((v - xMin) / (xMax - xMin)) * (W - L - R);
    const Y = (v) => T + (1 - v) * (H - T - B);
    g.font = '12px "Roboto Mono", monospace';
    g.fillStyle = farbe('--md-on-surface-variant');
    g.strokeStyle = farbe('--md-outline-variant');
    g.lineWidth = 1;
    for (let r = 0; r <= 1.001; r += 0.25) {
      g.beginPath(); g.moveTo(L, Y(r)); g.lineTo(W - R, Y(r)); g.stroke();
      g.textAlign = 'right'; g.fillText(String(Math.round(r * 100)), L - 6, Y(r) + 4);
    }
    const schritt = (xMax - xMin) > 24 ? 4 : 2;
    for (let v = Math.ceil(xMin / schritt) * schritt; v <= xMax; v += schritt) {
      g.textAlign = 'center'; g.fillText(String(v), X(v), H - B + 16);
      g.beginPath(); g.moveTo(X(v), Y(0)); g.lineTo(X(v), Y(0) + 4); g.stroke();
    }
    g.fillText(t('sim.axis.x'), L + (W - L - R) / 2, H - 6);
    g.save(); g.translate(12, T + (H - T - B) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(t('sim.axis.y'), 0, 0); g.restore();
    g.setLineDash([5, 4]); g.strokeStyle = farbe('--md-outline'); g.beginPath(); g.moveTo(L, Y(0.5)); g.lineTo(W - R, Y(0.5)); g.stroke(); g.setLineDash([]);
    serien.forEach((s, i) => {
      const c = farbe(`--serie-${i + 1}`);
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
      const pts = [...s.punkte].sort((a, b) => a.snrDb - b.snrDb);
      g.beginPath();
      pts.forEach((p, k) => { if (k) g.lineTo(X(p.snrDb), Y(p.rate)); else g.moveTo(X(p.snrDb), Y(p.rate)); });
      g.stroke();
      for (const p of pts) marker(g, MARKER[i % 4], X(p.snrDb), Y(p.rate), 4);
      // Beschriftung der Linie an ihrem rechten Ende (kleinster Rauschabstand, wo noch Erfolg), sonst am Anfang
      g.font = '500 12px "Roboto Mono", monospace'; g.textAlign = 'left';
      marker(g, MARKER[i % 4], L + 6 + i * 74, 10, 4);
      g.fillText(s.name, L + 14 + i * 74, 14);
    });
  }

  function schreibeErgebnis(serien, abgebrochen) {
    const aus = $('reiheErgebnis');
    aus.replaceChildren();
    const mitSchwelle = [];
    for (const s of serien) {
      const sw = schwelle50(s.punkte);
      zeile(aus, `${s.name}: ${t('sim.threshold')}`, sw === null ? t('sim.noThreshold') : `${zahl(sw, 1)} dB`);
      if (sw !== null) mitSchwelle.push({ kt: s.kt, sw });
    }
    if (mitSchwelle.length >= 2) {
      const a = mitSchwelle[0], z = mitSchwelle.at(-1);
      const gewinn = (a.sw - z.sw) / Math.log2(z.kt / a.kt);
      zeile(aus, t('sim.gain'), t('sim.gainValue', { db: zahl(gewinn, 1) }));
    }
    const wenige = Math.min(...serien.map((s) => Math.min(...s.punkte.map((p) => p.n))));
    if (Number.isFinite(wenige) && wenige < 6) urteilBox(aus, 'warn', t('sim.fewRuns', { n: wenige }));
    const falsch = serien.reduce((n, s) => n + s.punkte.reduce((m, p) => m + p.falsch, 0), 0);
    if (falsch) urteilBox(aus, 'warn', t('sim.falseWarn', { n: falsch }));
    // Zahlen als Tabelle (auch für Bedienung ohne Farbunterscheidung)
    const snrs = [...new Set(serien.flatMap((s) => s.punkte.map((p) => p.snrDb)))].sort((a, b) => b - a);
    const tab = document.createElement('table');
    tab.className = 'tabelle';
    tab.innerHTML = `<caption class="hint body-sm" style="text-align:left">${t('sim.table')}</caption>`;
    const kopf = tab.insertRow();
    for (const h of ['dB', ...serien.map((s) => s.name)]) { const th = document.createElement('th'); th.textContent = h; kopf.append(th); }
    for (const snr of snrs) {
      const zl = tab.insertRow();
      zl.insertCell().textContent = String(snr);
      for (const s of serien) { const p = s.punkte.find((x) => x.snrDb === snr); zl.insertCell().textContent = p ? `${p.ok}/${p.n}` : ''; }
    }
    aus.append(tab);
    if (abgebrochen) $('reiheStatus').textContent = t('sim.canceled');
  }

  let reiheAbbruch = false;
  async function reihe() {
    if (laeuft) return;
    let plan;
    try { plan = reihenPlan(); } catch (e) { $('reiheStatus').textContent = t('sim.badInput', { msg: e.message }); return; }
    if (plan.some((x) => !x.liste.length)) { $('reiheStatus').textContent = t('sim.badInput', { msg: '—' }); return; }
    laeuft = true; reiheAbbruch = false;
    $('btnReihe').disabled = true; $('btnReiheAbbruch').hidden = false;
    $('reiheErgebnis').replaceChildren();
    const basis = basisParameter();
    const gesamt = plan.reduce((s, x) => s + x.liste.length * x.versuche, 0);
    let vorher = 0;
    const serien = [];
    try {
      for (const teil of plan) {
        const serie = { kt: teil.kt, name: t('sim.seconds', { s: 15 * teil.kt }), punkte: [] };
        serien.push(serie);
        const r = await laufeReihe({
          basis: { ...basis, kt: teil.kt }, snrListe: teil.liste, versuche: teil.versuche, versuch: versuchImWorker,
          abgebrochen: () => reiheAbbruch,
          beiFortschritt: (f) => {
            msProKt[teil.kt] = f.msProVersuch;
            const rest = plan.reduce((s, x) => s + x.liste.length * x.versuche * (msProKt[x.kt] ?? SCHAETZ_MS[x.kt]), 0) * (1 - (vorher + f.fertig) / gesamt);
            $('reiheStatus').textContent = t('sim.progress', { done: vorher + f.fertig, total: gesamt, snr: f.snrDb, time: dauerText(rest) });
          },
        });
        serie.punkte = r;
        vorher += teil.liste.length * teil.versuche;
        zeichneDiagramm(serien);
        if (reiheAbbruch) break;
      }
      schreibeErgebnis(serien, reiheAbbruch);
      if (!reiheAbbruch) $('reiheStatus').textContent = t('sim.done');
    } catch (e) {
      $('reiheStatus').textContent = reiheAbbruch ? t('sim.canceled') : t('lab.failed', { msg: e.message });
    } finally {
      laeuft = false;
      $('btnReihe').disabled = false; $('btnReiheAbbruch').hidden = true;
    }
  }

  $('btnSimEin').addEventListener('click', einzelversuch);
  $('btnReihe').addEventListener('click', reihe);
  $('btnReiheAbbruch').addEventListener('click', () => { reiheAbbruch = true; simulator?.close(); simulator = null; });
  for (const id of ['reiheVon', 'reiheBis']) $(id).addEventListener('input', () => { bereichVonHand = true; zeigeSchaetzung(); });
  for (const id of ['reiheSchritt', 'reiheN', 'reiheWelche']) $(id).addEventListener('input', zeigeSchaetzung);
  fuelleBereich();

  // ----------------------------------------------------------------------------------------
  // Verbindungstest mit einem zweiten Gerät (Ablauf und Auswertung: src/verbindungstest.js)
  let vt = null;
  let vtTakt = null;
  let vtAbo = null;
  let vtZeilen = [];
  const sek = (x, s = 2) => `${x < 0 ? '−' : '+'}${zahl(Math.abs(x), s)}`;
  const zeitUtc = (ms) => new Date(ms).toISOString().slice(11, 19);

  function vtZeigeKnopf() {
    const aktiv = !!vt && (vt.zustand === 'wartet' || vt.zustand === 'laeuft');
    $('btnVtText').textContent = t(aktiv ? 'vt.cancel' : 'vt.start');
    $('vtRolle').disabled = aktiv;
    $('vtRunden').disabled = aktiv;
  }

  function vtZeichneRunden(fertig = false) {
    const l = $('vtRunde');
    l.hidden = !vt;
    l.replaceChildren();
    if (!vt) return;
    for (let r = 1; r <= vt.runden; r++) {
      const rx = vt.empfangen.find((x) => x.runde === r);
      const tx = vtZeilen.includes(r);
      const rxText = rx ? t('vt.rx', { snr: zahl(rx.snrDb, 0), dt: sek(rx.dtSec) }) : fertig ? t('vt.notReceived') : t('vt.none');
      const d = document.createElement('div');
      d.textContent = t('vt.row', { n: r, tx: tx ? t('vt.sent') : fertig ? t('vt.notSent') : t('vt.none'), rx: rxText });
      l.append(d);
    }
  }

  function vtStatus() {
    if (!vt) return;
    const jetztMs = jetzt();
    if (vt.zustand === 'wartet') {
      $('vtStatus').textContent = t('vt.plan', { time: zeitUtc(vt.plan.startMs), sec: Math.max(0, Math.round((vt.plan.startMs - jetztMs) / 1000)) });
    } else if (vt.zustand === 'laeuft') {
      const f = vt.plan.fenster;
      const idx = slotInfo(jetztMs, vt.profile).index;
      const k = idx - f[0].index; // 0-basiert, vor dem Start negativ
      const gesamt = f.length > 0 ? f.at(-1).index - f[0].index + 1 : 0;
      const eintrag = f.find((x) => x.index === idx);
      const wer = eintrag ? (eintrag.rolle === vt.rolle ? t('vt.sends') : t('vt.listens')) + (eintrag.art === 'ende' ? ` (${t('vt.summary')})` : '') : t('vt.pause');
      $('vtStatus').textContent = t('vt.running', { n: Math.min(gesamt, Math.max(1, k + 1)), total: gesamt, wer });
    }
  }

  function vtBeenden() {
    clearInterval(vtTakt);
    vtTakt = null;
    vtAbo?.();
    vtAbo = null;
    laeuft = false;
    vtZeigeKnopf();
  }

  function vtZeigeErgebnis(erg) {
    const aus = $('vtErgebnis');
    aus.replaceChildren();
    const gegen = erg.rolle === 'A' ? 'B' : 'A';
    const richtung = (r) => (r && r.anzahl ? t(r.dtStreuSec !== undefined && r.dtStreuSec !== null ? 'vt.res.lineSpread' : 'vt.res.line', { n: r.anzahl, total: r.von, snr: zahl(r.snrDb, 0), dt: sek(r.dtSec), spread: r.dtStreuSec != null ? zahl(r.dtStreuSec, 2) : '' }) : t('vt.res.nothing'));
    zeile(aus, t('vt.res.in', { x: gegen }), richtung(erg.ein));
    zeile(aus, t('vt.res.out', { x: gegen }), erg.aus ? richtung(erg.aus) : t('vt.none'));
    if (erg.mittelSec !== null) zeile(aus, t('vt.res.mean'), `${sek(erg.mittelSec)} s`);
    if (erg.uhrSec !== null) zeile(aus, t('vt.res.clock', { x: gegen }), `${sek(erg.uhrSec)} s`);
    for (const b of erg.befunde) urteilBox(aus, b === 'gut' ? 'ok' : 'warn', t(`vt.verdict.${b}`));
    const knopf = document.createElement('button');
    knopf.type = 'button'; knopf.className = 'btn tonal'; knopf.style.marginTop = '12px';
    const s = document.createElement('span'); s.textContent = t('vt.save'); knopf.append(s);
    knopf.addEventListener('click', () => herunterladen(`${ergebnisAlsText(erg)}\n`, `ft8-horch-verbindungstest_${new Date(erg.jetztMs).toISOString().slice(0, 10).replace(/-/g, '')}.txt`, 'text/plain'));
    aus.append(knopf);
  }

  // Nur für die Bilder der Anleitung: zeigt ein fertiges Ergebnis mit Beispieldaten, ohne dass ein Test lief
  function zeigeVtBeispiel({ ergebnis, empfangen, gesendet }) {
    vt = { zustand: 'fertig', runden: ergebnis.plan.runden, empfangen, rolle: ergebnis.rolle };
    vtZeilen = gesendet;
    vtZeichneRunden(true);
    vtZeigeErgebnis(ergebnis);
    $('vtStatus').textContent = t('vt.done');
  }

  function vtEreignis(e) {
    if (e.type === 'plan') {
      vtZeilen = [];
      vtZeichneRunden();
      vtStatus();
    } else if (e.type === 'tx') {
      if (e.art === 'runde') vtZeilen.push(e.runde);
      vtZeichneRunden();
    } else if (e.type === 'rx') {
      vtZeichneRunden();
    } else if (e.type === 'fertig') {
      vtZeichneRunden(true);
      $('vtStatus').textContent = t('vt.done');
      vtZeigeErgebnis(e.ergebnis);
      vtBeenden();
    } else if (e.type === 'abgebrochen') {
      $('vtStatus').textContent = t('vt.aborted');
      vtBeenden();
    }
  }

  async function verbindungstest() {
    if (vt && (vt.zustand === 'wartet' || vt.zustand === 'laeuft')) { vt.stop(); return; }
    if (laeuft) return;
    if (qsoAktiv()) { meldung(t('lab.qsoActive')); return; }
    const st = station();
    if (!st) { meldung(t('vt.needCall')); return; }
    const runden = Math.round(Number($('vtRunden').value));
    if (!(runden >= MIN_RUNDEN && runden <= MAX_RUNDEN)) { $('vtStatus').textContent = t('sim.badInput', { msg: `${MIN_RUNDEN}–${MAX_RUNDEN}` }); return; }
    setzeEinstellung('vtRolle', $('vtRolle').value);
    setzeEinstellung('vtRunden', runden);
    laeuft = true;
    $('btnVt').disabled = true;
    try {
      $('vtStatus').textContent = t('lab.startingAudio');
      await audio.starte();
    } catch (e) {
      $('vtStatus').textContent = t('qso.micError', { msg: `${e.name}: ${e.message}` });
      laeuft = false; $('btnVt').disabled = false;
      return;
    }
    $('btnVt').disabled = false;
    $('vtErgebnis').replaceChildren();
    const p = profil();
    vt = new Verbindungstest({
      rolle: $('vtRolle').value, profile: p, runden, clock: { now: jetzt },
      encode: (text, pp) => renderSlot(encodeMessage(text).tones, pp),
      play: (w, r, startMs, maxSpaet) => audio.ausgabe.play(w, r, startMs, maxSpaet),
      onEvent: vtEreignis,
      sendefenster: (i) => station()?.markiereSendefenster(i),
    });
    vtAbo = abonniere((e) => vt.beiDecodiert(e));
    vt.starte();
    vtTakt = setInterval(() => {
      vt.tick().catch((fehler) => { $('vtStatus').textContent = t('lab.failed', { msg: fehler.message }); });
      vtStatus();
    }, 100);
    vtZeigeKnopf();
    meldung(t('vt.profile', { kt: p.kt, kf: p.kf, f0: Math.round(p.f0) }));
  }

  $('vtRolle').value = einstellung('vtRolle') === 'B' ? 'B' : 'A';
  $('vtRunden').value = String(Math.min(MAX_RUNDEN, Math.max(MIN_RUNDEN, Number(einstellung('vtRunden')) || 4)));
  $('btnVt').addEventListener('click', verbindungstest);
  vtZeigeKnopf();

  // ----------------------------------------------------------------------------------------
  // WAV-Dateien: Aufnahme des letzten Fensters speichern, Datei laden und decodieren
  const hmsUtc = (ms) => new Date(ms).toISOString().slice(11, 19);

  function speichereFenster() {
    const rec = audio.mik.recorder;
    if (rec.startedAtMs === null) { meldung(t('wav.needMic')); return; }
    const p = profil();
    const start = slotInfo(jetzt(), p).startMs - p.slotSec * 1000; // das letzte vollständige Fenster
    const vorlauf = VORLAUF_JE_KT_SEC * p.kt;
    const f = rec.sliceWindow(start, start + p.slotSec * 1000, vorlauf);
    if (!f || f.availableSec < p.slotSec - 0.5) { meldung(t('wav.notEnough')); return; }
    herunterladen(encodeWav(f.samples, SAMPLE_RATE), dateinameAufnahme({ startMs: start, kt: p.kt, kf: p.kf, vorlaufSec: vorlauf }), 'audio/wav');
    $('wavStatus').textContent = t('wav.saved', { time: hmsUtc(start), sec: zahl(f.samples.length / SAMPLE_RATE, 1) });
  }

  let wavDecoder = null;

  function wavZeile(ziel, text, klasse = '', knopf = null) {
    const d = document.createElement('div');
    if (klasse) d.className = klasse;
    const s = document.createElement('span');
    s.textContent = text;
    if (!knopf) { d.textContent = text; ziel.append(d); return; }
    d.classList.add('mitknopf');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn klein';
    b.title = knopf.titel;
    b.setAttribute('aria-label', knopf.titel);
    b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-code"/></svg>';
    b.addEventListener('click', knopf.aktion);
    d.append(s, b);
    ziel.append(d);
  }

  async function ladeWav(datei) {
    if (laeuft) return;
    const status = $('wavStatus');
    const aus = $('wavErgebnis');
    aus.replaceChildren();
    status.textContent = '';
    let a;
    try { a = leseAudiodatei(new Uint8Array(await datei.arrayBuffer())); } catch (e) { status.textContent = t('wav.readFailed', { msg: e.message }); return; }
    const dateiInfo = leseDateiname(datei.name);
    const basis = profil();
    const p = createProfile({ kt: dateiInfo.kt ?? basis.kt, kf: dateiInfo.kf ?? basis.kf, f0: basis.f0 });
    if (dateiInfo.vorlaufSec !== undefined) $('wavVorlauf').value = dateiInfo.vorlaufSec;
    const vorlauf = Math.max(0, Number($('wavVorlauf').value) || 0);
    const max = maxDateiSec(p, vorlauf);
    if (a.dauerSec > max) { status.textContent = t('wav.tooLong', { sec: zahl(a.dauerSec, 0), max: zahl(max, 0) }); return; }

    laeuft = true;
    $('btnWavLaden').disabled = true;
    status.textContent = t('wav.busy', { name: datei.name });
    try {
      wavDecoder ??= new DecoderClient();
      const fenster = Math.max(1, Math.ceil(a.dauerSec / p.slotSec));
      const r = await wavDecoder.decode(a.samples, p, {
        leadSec: vorlauf, startMinSec: -p.startOffsetSec, startMaxSec: a.dauerSec, maxCandidates: Math.min(400, 100 * fenster), zwischenwerte: true,
      }, Math.max(60000, 8 * p.slotSec * 1000));
      status.textContent = t('wav.result', { n: r.signals.length, sec: zahl(a.dauerSec, 1), ms: zahl(Math.round(r.ms), 0) });
      wavZeile(aus, t('wav.profile', { kt: p.kt, kf: p.kf, lead: zahl(vorlauf, 1) }) + (a.quellRate !== SAMPLE_RATE ? `, ${t('wav.resampled', { rate: a.quellRate })}` : ''), 'info');
      if (!r.signals.length) wavZeile(aus, t('wav.none'), 'info');
      const lagen = r.signals.map((s) => ({ s, ...lageImFenster(s.startSec, { vorlaufSec: vorlauf, profil: p }) }));
      lagen.sort((x, y) => x.fenster - y.fenster || x.s.f0 - y.s.f0);
      for (const { s, dtSec, fenster: nr } of lagen) {
        const text = `${fenster > 1 ? `F${nr} ` : ''}${String(Math.round(s.snrDb)).padStart(3)} dB ${dtSec.toFixed(1).padStart(4)} ${String(Math.round(s.f0)).padStart(4)}  ${s.text}`;
        wavZeile(aus, text, '', s.zw ? { titel: t('qso.viewCoding'), aktion: () => beiCodierung({ zw: s.zw, zeitMs: null, parity: null }) } : null);
      }
    } catch (e) {
      status.textContent = t('lab.failed', { msg: e.message });
    } finally {
      laeuft = false;
      $('btnWavLaden').disabled = false;
    }
  }

  $('btnWavSpeichern').addEventListener('click', speichereFenster);
  $('btnWavLaden').addEventListener('click', () => $('wavDatei').click());
  $('wavDatei').addEventListener('change', async () => { const d = $('wavDatei').files[0]; $('wavDatei').value = ''; if (d) await ladeWav(d); });

  $('btnPegel').addEventListener('click', pegeltest);
  $('btnLat').addEventListener('click', laufzeit);
  return { pegeltest, laufzeit, profilGeaendert: fuelleBereich, testLaeuft: () => !!vt && (vt.zustand === 'wartet' || vt.zustand === 'laeuft'), uebersetzt: vtZeigeKnopf, debug: { zeigeVtBeispiel } };
}
