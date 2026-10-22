// QSO-Log. Die Logik arbeitet gegen einen Speicher (IndexedDB im Browser, im Test im Arbeitsspeicher).
import { erzeugeAdif } from './adif.js';

const RUF = /^[A-Z0-9/]{3,}$/;
const LOC = /^[A-R]{2}\d{2}([A-X]{2})?$/;
const RAPPORT = /^[+-]\d{2}$/;

export class Log {
  constructor(speicher) { this.speicher = speicher; }

  async hinzufuegen(record, profile) {
    // Nur die Zahlen: Das Profil-Objekt der App enthält Funktionen, die sich nicht speichern lassen
    return this.speicher.hinzufuegen({ ...record, profile: { kt: profile.kt, kf: profile.kf, f0: profile.f0 } });
  }

  // Fertige Einträge (Sicherung, ADIF-Import) unverändert übernehmen; die Nummern vergibt der Speicher neu
  async importiere(liste) {
    return this.speicher.hinzufuegenViele(liste.map(({ id, ...rest }) => rest)); // eslint-disable-line no-unused-vars
  }

  // Neueste zuerst
  async alle() {
    const liste = await this.speicher.alle();
    return liste.sort((x, y) => (y.completedAtMs ?? 0) - (x.completedAtMs ?? 0) || y.id - x.id);
  }

  loesche(id) { return this.speicher.loesche(id); }
  leere() { return this.speicher.leere(); }

  // Ändert Rufzeichen, Locator, Rapporte, Bestätigung und Notiz. Rückgabe: Liste der abgelehnten Felder,
  // bei Fehlern wird nichts geändert. Zeiten, Profil und Nummer bleiben, wie sie waren.
  async aendere(id, felder) {
    const neu = {};
    const fehler = [];
    if ('dxCall' in felder) { const c = String(felder.dxCall).trim().toUpperCase(); if (RUF.test(c)) neu.dxCall = c; else fehler.push('dxCall'); }
    if ('dxGrid' in felder) { const g = String(felder.dxGrid ?? '').trim().toUpperCase(); if (!g) neu.dxGrid = null; else if (LOC.test(g)) neu.dxGrid = g; else fehler.push('dxGrid'); }
    for (const k of ['rptSent', 'rptRcvd']) {
      if (!(k in felder)) continue;
      const r = String(felder[k] ?? '').trim();
      if (!r) neu[k] = null; else if (RAPPORT.test(r)) neu[k] = r; else fehler.push(k);
    }
    if ('confirmed' in felder) neu.confirmed = !!felder.confirmed;
    if ('notiz' in felder) neu.notiz = String(felder.notiz ?? '').trim().slice(0, 200) || null;
    if (fehler.length) return fehler;
    return (await this.speicher.aktualisiere(id, neu)) ? [] : ['id'];
  }

  // ADIF in zeitlicher Reihenfolge (älteste zuerst)
  async alsAdif() {
    return erzeugeAdif((await this.alle()).reverse());
  }
}

export class SpeicherImRam {
  #daten = new Map();
  #naechste = 1;
  async hinzufuegen(r) { const id = this.#naechste++; this.#daten.set(id, structuredClone({ ...r, id })); return id; }
  async hinzufuegenViele(liste) { for (const r of liste) await this.hinzufuegen(r); }
  async alle() { return [...this.#daten.values()].map((r) => structuredClone(r)); }
  async aktualisiere(id, felder) { const r = this.#daten.get(id); if (!r) return false; Object.assign(r, felder); return true; }
  async loesche(id) { this.#daten.delete(id); }
  async leere() { this.#daten.clear(); }
  async begrenze(max) { for (const id of [...this.#daten.keys()].slice(0, Math.max(0, this.#daten.size - max))) this.#daten.delete(id); }
}

// IndexedDB: eine Datenbank (ft8-horch, Version 2) mit zwei Speichern: qso (Log) und protokoll (Textprotokoll).
export class Datenbank {
  constructor(name = 'ft8-horch', idb = globalThis.indexedDB) { this.name = name; this.idb = idb; this.db = null; }

  oeffne() {
    this.db ??= new Promise((ok, fehler) => {
      const anfrage = this.idb.open(this.name, 2);
      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        for (const n of ['qso', 'protokoll']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id', autoIncrement: true });
      };
      anfrage.onsuccess = () => ok(anfrage.result);
      anfrage.onerror = () => { this.db = null; fehler(anfrage.error); };
    });
    return this.db;
  }
}

export class SpeicherIndexedDb {
  constructor(datenbank = new Datenbank(), speicher = 'qso') { this.datenbank = datenbank; this.speicher = speicher; }

  async #lauf(modus, tun) {
    const db = await this.datenbank.oeffne();
    return new Promise((ok, fehler) => {
      const tx = db.transaction(this.speicher, modus);
      let ergebnis;
      Promise.resolve(tun(tx.objectStore(this.speicher))).then((r) => { ergebnis = r; }, fehler);
      tx.oncomplete = () => ok(ergebnis);
      tx.onerror = () => fehler(tx.error);
      tx.onabort = () => fehler(tx.error);
    });
  }

  // Hilfe: IDBRequest als Promise
  static #p(anfrage) { return new Promise((ok, fehler) => { anfrage.onsuccess = () => ok(anfrage.result); anfrage.onerror = () => fehler(anfrage.error); }); }

  hinzufuegen(r) { return this.#lauf('readwrite', (s) => SpeicherIndexedDb.#p(s.add(r))); }
  hinzufuegenViele(liste) { return this.#lauf('readwrite', (s) => { for (const r of liste) s.add(r); }); }
  alle() { return this.#lauf('readonly', (s) => SpeicherIndexedDb.#p(s.getAll())); }
  loesche(id) { return this.#lauf('readwrite', (s) => { s.delete(id); }); }
  leere() { return this.#lauf('readwrite', (s) => { s.clear(); }); }

  async aktualisiere(id, felder) {
    return this.#lauf('readwrite', async (s) => {
      const alt = await SpeicherIndexedDb.#p(s.get(id));
      if (!alt) return false;
      s.put({ ...alt, ...felder });
      return true;
    });
  }

  // Löscht die ältesten Zeilen, wenn mehr als max vorhanden sind
  begrenze(max) {
    return this.#lauf('readwrite', async (s) => {
      const n = await SpeicherIndexedDb.#p(s.count());
      let zuViel = n - max;
      if (zuViel <= 0) return;
      await new Promise((ok, fehler) => {
        const c = s.openCursor();
        c.onsuccess = () => { const k = c.result; if (k && zuViel-- > 0) { k.delete(); k.continue(); } else ok(); };
        c.onerror = () => fehler(c.error);
      });
    });
  }
}
