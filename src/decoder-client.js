// Gegenstück zum Decoder-Worker: decode() gibt ein Versprechen zurück. Aufträge laufen nacheinander.
// Hängt ein Auftrag länger als die Zeitgrenze oder stürzt der Worker ab, werden alle offenen Aufträge abgelehnt und der
// Worker neu gestartet, damit die Station nicht für immer auf ein Ergebnis wartet.
export class DecoderClient {
  constructor({ erzeuge = () => new Worker(new URL('./decoder-worker.js', import.meta.url), { type: 'module' }) } = {}) {
    this.erzeuge = erzeuge;
    this.naechsteId = 1;
    this.offen = new Map();
    this.#starte();
  }

  #starte() {
    this.worker = this.erzeuge();
    this.worker.onmessage = (ev) => {
      const { id, error, ...rest } = ev.data;
      const a = this.offen.get(id);
      if (!a) return;
      this.offen.delete(id);
      clearTimeout(a.zeitgeber);
      if (error) a.reject(new Error(error)); else a.resolve(rest);
    };
    this.worker.onerror = (ev) => this.#neustart(new Error(ev.message));
  }

  #neustart(fehler) {
    for (const a of this.offen.values()) { clearTimeout(a.zeitgeber); a.reject(fehler); }
    this.offen.clear();
    this.worker.terminate?.();
    this.#starte();
  }

  // samples wird an den Worker übergeben und ist danach leer. zeitgrenzeMs: danach gilt der Auftrag als hängengeblieben
  // (Vorgabe: zwei Fensterlängen des Profils)
  decode(samples, profil, opt = {}, zeitgrenzeMs = 2 * profil.slotSec * 1000) {
    const id = this.naechsteId++;
    return new Promise((resolve, reject) => {
      const zeitgeber = setTimeout(() => this.#neustart(new Error('Decoder antwortet nicht')), zeitgrenzeMs);
      this.offen.set(id, { resolve, reject, zeitgeber });
      this.worker.postMessage({ id, samples, profile: { kt: profil.kt, kf: profil.kf, f0: profil.f0 }, opt }, [samples.buffer]);
    });
  }

  close() {
    for (const a of this.offen.values()) clearTimeout(a.zeitgeber);
    this.worker.terminate();
  }
}
