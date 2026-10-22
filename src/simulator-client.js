// Gegenstück zum Simulator-Worker: versuch() gibt ein Versprechen zurück, die Aufträge laufen nacheinander.
export class SimulatorClient {
  constructor() {
    this.worker = new Worker(new URL('./simulator-worker.js', import.meta.url), { type: 'module' });
    this.naechsteId = 1;
    this.offen = new Map();
    this.worker.onmessage = (ev) => {
      const { id, ergebnis, error } = ev.data;
      const a = this.offen.get(id);
      if (!a) return;
      this.offen.delete(id);
      if (error) a.reject(new Error(error)); else a.resolve(ergebnis);
    };
    this.worker.onerror = (ev) => {
      for (const a of this.offen.values()) a.reject(new Error(ev.message));
      this.offen.clear();
    };
  }

  versuch(params) {
    const id = this.naechsteId++;
    return new Promise((resolve, reject) => {
      this.offen.set(id, { resolve, reject });
      this.worker.postMessage({ id, params });
    });
  }

  // Bricht einen laufenden Versuch ab (der Worker wird beendet und beim nächsten Versuch neu gestartet)
  close() {
    this.worker.terminate();
    for (const a of this.offen.values()) a.reject(new Error('abgebrochen'));
    this.offen.clear();
  }
}
