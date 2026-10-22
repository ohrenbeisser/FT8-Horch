// Log-Tab: QSO-Liste mit Suche, Filter und Bearbeiten, dazu das Textprotokoll mit Filter und Export.
import { Log, SpeicherIndexedDb, SpeicherImRam, Datenbank } from './src/log.js';
import { Protokoll, MAX_ZEILEN, filtereProtokoll, protokollAlsText, protokollAlsCsv, zeileAlsText } from './src/protokoll.js';
import { filtereQsos } from './src/logfilter.js';
import { findeQsos, schonImLog } from './src/qsofinder.js';
import { pruefeManuellesQso, datumZeitAusMs } from './src/qsomanuell.js';
import { parseAdif, adifZuEintrag } from './src/adif.js';
import { bereinigeQso, neueQsos, neueProtokollzeilen } from './src/sicherung.js';
import { fordereDauerhaft } from './src/speicher.js';
import { herunterladen } from './src/herunterladen.js';
import { createProfile } from './src/profile.js';
import { t } from './src/i18n.js';

const $ = (id) => document.getElementById(id);
const hms = (ms) => new Date(ms).toISOString().slice(11, 19);
const SEITE = 200; // so viele Protokollzeilen werden auf einmal gezeichnet

function oeffne() {
  try {
    if (!globalThis.indexedDB) throw new Error('keine IndexedDB');
    const db = new Datenbank();
    return { log: new Log(new SpeicherIndexedDb(db, 'qso')), protokoll: new Protokoll(new SpeicherIndexedDb(db, 'protokoll')) };
  } catch {
    return { log: new Log(new SpeicherImRam()), protokoll: new Protokoll(new SpeicherImRam()) };
  }
}

const heute = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

export function erzeugeLogAnsicht({ meldung, bestaetige, meinCall, meinGrid = () => '', profil }) {
  let { log, protokoll } = oeffne();
  let ansicht = 'qso';
  let protokollAnzahl = SEITE;
  let puffer = [];
  let pufferZeit = 0;

  const ramNutzen = () => { ({ log, protokoll } = { log: new Log(new SpeicherImRam()), protokoll: new Protokoll(new SpeicherImRam()) }); meldung(t('log.noStorage')); };

  // -------------------------------------------------------------------------------------------
  // QSO-Liste
  // Von und Bis sind mit dem ersten und dem letzten Eintrag vorbelegt (ohne Eintrag: heute, UTC), solange der
  // Nutzer sie nicht selbst ändert
  let vonAuto = true;
  let bisAuto = true;
  const tag = (ms) => new Date(ms).toISOString().slice(0, 10);

  async function zeichneQsos() {
    let alle = [];
    try { alle = await log.alle(); } catch { ramNutzen(); }
    const zeiten = alle.map((r) => r.completedAtMs).filter(Number.isFinite);
    if (vonAuto) $('logVon').value = tag(zeiten.length ? Math.min(...zeiten) : Date.now());
    if (bisAuto) $('logBis').value = tag(zeiten.length ? Math.max(...zeiten) : Date.now());
    const liste = filtereQsos(alle, { text: $('logSuche').value, status: $('logStatus').value, von: $('logVon').value, bis: $('logBis').value });
    const l = $('log');
    l.replaceChildren();
    $('btnExport').disabled = !alle.length;
    $('btnLeeren').disabled = !alle.length;
    $('logZahl').textContent = alle.length ? t('log.count', { n: liste.length, total: alle.length }) : '';
    if (!liste.length) {
      const d = document.createElement('div');
      d.className = 'info';
      d.textContent = alle.length ? t('log.none') : t('log.empty');
      l.append(d);
      return;
    }
    for (const r of liste) {
      const d = document.createElement('div');
      d.className = 'logzeile';
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = `${hms(r.completedAtMs)}  ` + t('log.entry', {
        dx: r.dxCall, grid: r.dxGrid ?? '----', sent: r.rptSent ?? '?', rcvd: r.rptRcvd ?? '?', unconfirmed: r.confirmed ? '' : t('log.unconfirmed'),
      });
      const klein = document.createElement('div');
      klein.className = 'klein';
      const p = r.profile ?? { kt: 1, kf: 1 };
      const art = p.kt === 1 && p.kf === 1 ? t('profile.standard') : `${t('profile.variant')} kt=${p.kt} kf=${p.kf}`;
      klein.textContent = `${new Date(r.completedAtMs).toISOString().slice(0, 10)} · ${art}${r.manuell ? ` · ${t('log.manual')}` : ''}${r.importiert ? ` · ${t('log.imported')}${r.band ? ` ${r.band}` : ''}` : ''}${r.notiz ? ` · ${r.notiz}` : ''}`;
      text.append(klein);
      d.append(text, symbolKnopf('edit', t('log.edit'), () => bearbeiten(r)), symbolKnopf('delete', t('log.delete'), () => bestaetige(t('log.deleteTitle'), t('log.deleteText', { dx: r.dxCall }), async () => { await log.loesche(r.id); zeichne(); })));
      l.append(d);
    }
  }

  function symbolKnopf(symbol, titel, beiKlick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.setAttribute('aria-label', titel);
    b.title = titel;
    b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${symbol}"/></svg>`;
    b.addEventListener('click', beiKlick);
    return b;
  }

  let bearbeitet = null;
  let neuModus = false;
  let dublettenGewarnt = false;
  function zeigeDialog(neu) {
    neuModus = neu;
    dublettenGewarnt = false;
    $('eNeu').hidden = !neu;
    $('dlgBearbeitenTitel').textContent = t(neu ? 'log.addTitle' : 'log.editTitle');
    $('eWarn').textContent = '';
    $('dlgBearbeiten').showModal();
  }

  // Neues QSO von Hand, auf Wunsch mit Werten aus dem Protokoll vorbelegt
  function neuesQso(k = null) {
    bearbeitet = null;
    const p = profil();
    const standard = p.kt === 1 && p.kf === 1;
    $('eProfil').replaceChildren(new Option(t('profile.standard'), 'standard'));
    if (!standard) $('eProfil').append(new Option(`${t('profile.variant')} kt=${p.kt} kf=${p.kf}`, 'aktuell'));
    $('eProfil').value = standard ? 'standard' : 'aktuell';
    const start = datumZeitAusMs(k ? k.startMs : Date.now() - 120_000);
    const ende = datumZeitAusMs(k ? k.endeMs : Date.now());
    $('eDatum').value = start.datum;
    $('eVon').value = start.zeit;
    $('eBis').value = ende.zeit;
    $('eCall').value = k?.dxCall ?? '';
    $('eGrid').value = k?.dxGrid ?? '';
    $('eSent').value = k?.rptSent ?? '';
    $('eRcvd').value = k?.rptRcvd ?? '';
    $('eConf').value = k?.confirmed ? '1' : '0';
    $('eNotiz').value = '';
    zeigeDialog(true);
  }

  function bearbeiten(r) {
    bearbeitet = r;
    $('eCall').value = r.dxCall ?? '';
    $('eGrid').value = r.dxGrid ?? '';
    $('eSent').value = r.rptSent ?? '';
    $('eRcvd').value = r.rptRcvd ?? '';
    $('eConf').value = r.confirmed ? '1' : '0';
    $('eNotiz').value = r.notiz ?? '';
    zeigeDialog(false);
  }

  async function speichereNeu(felder) {
    const { fehler, eintrag } = pruefeManuellesQso(
      { ...felder, datum: $('eDatum').value, von: $('eVon').value, bis: $('eBis').value },
      { meinCall: meinCall(), meinGrid: meinGrid(), jetztMs: Date.now() },
    );
    if (!eintrag) {
      const namen = { meinCall: t('log.field.myCall'), dxCall: t('log.field.call'), dxGrid: t('log.field.grid'), rptSent: t('log.field.sent'), rptRcvd: t('log.field.rcvd'), datum: t('log.field.date'), von: t('log.field.from'), bis: t('log.field.until') };
      $('eWarn').textContent = t('log.invalid', { fields: fehler.map((f) => namen[f] ?? f).join(', ') });
      return;
    }
    // Ähnlicher Eintrag schon da: einmal warnen, beim zweiten Speichern gilt es als gewollt
    let vorhandene = [];
    try { vorhandene = await log.alle(); } catch { /* ohne Log keine Warnung */ }
    const kandidat = { dxCall: eintrag.dxCall, startMs: eintrag.startedAtMs, endeMs: eintrag.completedAtMs };
    if (!dublettenGewarnt && schonImLog(kandidat, vorhandene)) {
      dublettenGewarnt = true;
      $('eWarn').textContent = t('log.duplicate', { dx: eintrag.dxCall });
      return;
    }
    const prof = $('eProfil').value === 'standard' ? createProfile({}) : profil();
    try { await log.hinzufuegen(eintrag, prof); } catch { $('eWarn').textContent = t('log.storeFailed'); return; }
    $('dlgBearbeiten').close();
    meldung(t('log.stored', { dx: eintrag.dxCall }));
    zeichne();
  }

  async function speichereBearbeitung() {
    const felder = { dxCall: $('eCall').value, dxGrid: $('eGrid').value, rptSent: $('eSent').value, rptRcvd: $('eRcvd').value, confirmed: $('eConf').value === '1', notiz: $('eNotiz').value };
    if (neuModus) { await speichereNeu(felder); return; }
    let fehler;
    try { fehler = await log.aendere(bearbeitet.id, felder); } catch { fehler = ['id']; }
    if (fehler.length) {
      const namen = { dxCall: t('log.field.call'), dxGrid: t('log.field.grid'), rptSent: t('log.field.sent'), rptRcvd: t('log.field.rcvd'), id: t('log.storeFailed') };
      $('eWarn').textContent = t('log.invalid', { fields: fehler.map((f) => namen[f] ?? f).join(', ') });
      return;
    }
    $('dlgBearbeiten').close();
    meldung(t('log.edited'));
    zeichne();
  }

  async function speichereQso(r) {
    try {
      await log.hinzufuegen(r, profil());
      meldung(t('log.stored', { dx: r.dxCall }));
      fordereDauerhaft(); // das Log soll der Browser bei Platzmangel nicht löschen dürfen
    } catch { meldung(t('log.storeFailed')); }
    zeichne();
  }

  async function exportiereAdif() {
    const alle = await log.alle();
    if (!alle.length) { meldung(t('log.nothing')); return; }
    herunterladen(await log.alsAdif(), `ft8-horch_${heute()}.adi`, 'text/plain');
    meldung(t('log.exported', { n: alle.length }));
  }

  const MAX_DATEI_BYTES = 20 * 1024 * 1024;

  async function importiereAdif(datei) {
    const status = $('importStatus');
    status.textContent = '';
    if (datei.size > MAX_DATEI_BYTES) { status.textContent = t('log.import.big'); return; }
    let text;
    try { text = await datei.text(); } catch { status.textContent = t('log.import.failed'); return; }
    const saetze = parseAdif(text);
    if (!saetze.length) { status.textContent = t('log.import.none'); return; }
    let andere = 0;
    let ungueltig = 0;
    const kandidaten = [];
    for (const satz of saetze) {
      const { grund, eintrag } = adifZuEintrag(satz);
      if (grund === 'betriebsart') andere++;
      else if (grund) ungueltig++;
      else { const b = bereinigeQso(eintrag); if (b) kandidaten.push(b); else ungueltig++; }
    }
    let vorhanden = [];
    try { vorhanden = await log.alle(); } catch { /* ohne Log ist alles neu */ }
    const { neu, dubletten } = neueQsos(vorhanden, kandidaten);
    try { if (neu.length) await log.importiere(neu); } catch { status.textContent = t('log.storeFailed'); return; }
    status.textContent = t('log.import.result', { n: neu.length, dup: dubletten, other: andere, bad: ungueltig });
    if (neu.length) fordereDauerhaft();
    zeichne();
  }

  // Daten für die Sicherung (alles, was im Browser liegt) und Wiederherstellung (ergänzt, ohne Dubletten)
  async function sicherungsdaten() {
    await leerePuffer();
    return { qsos: await log.alle(), protokoll: await protokoll.alle() };
  }

  async function spieleSicherungEin({ qsos, protokoll: zeilen }) {
    await leerePuffer();
    const q = neueQsos(await log.alle(), qsos);
    if (q.neu.length) await log.importiere(q.neu);
    const p = neueProtokollzeilen(await protokoll.alle(), zeilen);
    if (p.neu.length) await protokoll.hinzufuegen(p.neu);
    zeichne();
    return { qsos: q.neu.length, qsosDoppelt: q.dubletten, protokoll: p.neu.length };
  }

  // -------------------------------------------------------------------------------------------
  // Textprotokoll
  function aufPuffer(zeile) {
    puffer.push(zeile);
    clearTimeout(pufferZeit);
    pufferZeit = setTimeout(leerePuffer, 400);
  }

  async function leerePuffer() {
    const zeilen = puffer;
    puffer = [];
    if (!zeilen.length) return;
    try { await protokoll.hinzufuegen(zeilen); } catch { /* das Protokoll ist nur Beiwerk, ein Fehler darf nichts stören */ }
    if (ansicht === 'protokoll') zeichneProtokoll();
  }

  // QSOs, die im Protokoll stehen, aber noch nicht im Log
  async function zeichneFunde(zeilen) {
    let eintraege = [];
    try { eintraege = await log.alle(); } catch { /* ohne Log gelten alle Funde als neu */ }
    const funde = findeQsos(zeilen, meinCall()).filter((k) => !schonImLog(k, eintraege));
    $('findKarte').hidden = !funde.length;
    const l = $('findListe');
    l.replaceChildren();
    for (const k of funde) {
      const d = document.createElement('div');
      d.className = 'logzeile';
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = `${hms(k.endeMs)}  ` + t('log.entry', {
        dx: k.dxCall, grid: k.dxGrid ?? '----', sent: k.rptSent ?? '?', rcvd: k.rptRcvd ?? '?', unconfirmed: k.confirmed ? '' : t('log.unconfirmed'),
      });
      const klein = document.createElement('div');
      klein.className = 'klein';
      klein.textContent = new Date(k.endeMs).toISOString().slice(0, 10);
      text.append(klein);
      d.append(text, symbolKnopf('add', t('find.take'), () => neuesQso(k)));
      l.append(d);
    }
  }

  async function zeichneProtokoll() {
    let alle = [];
    try { alle = await protokoll.alle(); } catch { ramNutzen(); }
    zeichneFunde(alle);
    const art = document.querySelector('#segProto [aria-pressed="true"]')?.dataset.art ?? 'alle';
    const liste = filtereProtokoll(alle, { art, text: $('protoSuche').value, meinCall: meinCall() }).reverse(); // neueste zuerst
    const l = $('protoListe');
    l.replaceChildren();
    for (const id of ['btnProtoTxt', 'btnProtoCsv', 'btnProtoLeeren']) $(id).disabled = !alle.length;
    $('protoZahl').textContent = alle.length ? t('proto.count', { n: liste.length, total: alle.length }) : '';
    if (!liste.length) {
      const d = document.createElement('div');
      d.className = 'info';
      d.textContent = alle.length ? t('log.none') : t('proto.empty');
      l.append(d);
      $('btnProtoMehr').hidden = true;
      return;
    }
    const mein = meinCall();
    for (const z of liste.slice(0, protokollAnzahl)) {
      const d = document.createElement('div');
      d.textContent = zeileAlsText(z);
      if (z.typ === 'tx') d.className = 'tx';
      else if (mein && z.text.toUpperCase().split(/\s+/).includes(mein)) d.className = 'anmich';
      l.append(d);
    }
    $('btnProtoMehr').hidden = liste.length <= protokollAnzahl;
  }

  async function exportiereProtokoll(format) {
    const art = document.querySelector('#segProto [aria-pressed="true"]')?.dataset.art ?? 'alle';
    const zeilen = filtereProtokoll(await protokoll.alle(), { art, text: $('protoSuche').value, meinCall: meinCall() });
    if (!zeilen.length) { meldung(t('log.nothing')); return; }
    if (format === 'csv') herunterladen(`﻿${protokollAlsCsv(zeilen)}\n`, `ft8-horch-protokoll_${heute()}.csv`, 'text/csv');
    else herunterladen(`${protokollAlsText(zeilen)}\n`, `ft8-horch-protokoll_${heute()}.txt`, 'text/plain');
    meldung(t('proto.exported', { n: zeilen.length }));
  }

  // -------------------------------------------------------------------------------------------
  function zeichne() { return ansicht === 'qso' ? zeichneQsos() : zeichneProtokoll(); }

  function waehleAnsicht(name) {
    ansicht = name;
    for (const b of document.querySelectorAll('#segLog button')) b.setAttribute('aria-pressed', String(b.dataset.ansicht === name));
    $('log-qso').hidden = name !== 'qso';
    $('log-protokoll').hidden = name !== 'protokoll';
    zeichne();
  }

  for (const b of document.querySelectorAll('#segLog button')) b.addEventListener('click', () => waehleAnsicht(b.dataset.ansicht));
  for (const b of document.querySelectorAll('#segProto button')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('#segProto button')) x.setAttribute('aria-pressed', String(x === b));
      protokollAnzahl = SEITE;
      zeichneProtokoll();
    });
  }
  for (const id of ['logSuche', 'logStatus']) $(id).addEventListener('input', zeichneQsos);
  $('logVon').addEventListener('input', () => { vonAuto = false; zeichneQsos(); });
  $('logBis').addEventListener('input', () => { bisAuto = false; zeichneQsos(); });
  $('protoSuche').addEventListener('input', () => { protokollAnzahl = SEITE; zeichneProtokoll(); });
  $('btnProtoMehr').addEventListener('click', () => { protokollAnzahl += SEITE; zeichneProtokoll(); });
  $('btnAdd').addEventListener('click', () => neuesQso());
  $('btnExport').addEventListener('click', exportiereAdif);
  $('btnImport').addEventListener('click', () => $('adifDatei').click());
  $('adifDatei').addEventListener('change', async () => { const d = $('adifDatei').files[0]; $('adifDatei').value = ''; if (d) await importiereAdif(d); });
  $('btnLeeren').addEventListener('click', () => bestaetige(t('log.clearTitle'), t('log.clearText'), async () => { await log.leere(); zeichne(); }));
  $('btnProtoTxt').addEventListener('click', () => exportiereProtokoll('txt'));
  $('btnProtoCsv').addEventListener('click', () => exportiereProtokoll('csv'));
  $('btnProtoLeeren').addEventListener('click', () => bestaetige(t('proto.clearTitle'), t('proto.clearText'), async () => { await protokoll.leere(); zeichne(); }));
  $('btnEditSpeichern').addEventListener('click', speichereBearbeitung);
  $('protoHinweis').textContent = t('proto.note', { max: MAX_ZEILEN });

  zeichne();
  return {
    speichereQso,
    alleQsos: () => log.alle(),
    sicherungsdaten,
    spieleSicherungEin,
    aufProtokoll: aufPuffer,
    zeichne,
    uebersetzt() { $('protoHinweis').textContent = t('proto.note', { max: MAX_ZEILEN }); zeichne(); },
  };
}
