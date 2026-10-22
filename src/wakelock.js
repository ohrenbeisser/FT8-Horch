// Display wach halten, solange gesendet oder empfangen wird (Wake Lock API). Der Browser gibt die
// Sperre beim Wechsel der App frei, deshalb wird sie beim Zurückkommen neu angefordert.

export class WakeLock {
  constructor() {
    this.sperre = null;
    this.gewuenscht = false;
    document.addEventListener?.('visibilitychange', () => {
      if (this.gewuenscht && document.visibilityState === 'visible') this.anfordern();
    });
  }

  get unterstuetzt() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async anfordern() {
    if (!this.unterstuetzt) return false;
    try {
      this.sperre = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false; // z. B. Energiesparmodus; die App läuft trotzdem
    }
  }

  async halten() {
    this.gewuenscht = true;
    return this.anfordern();
  }

  async freigeben() {
    this.gewuenscht = false;
    try { await this.sperre?.release(); } catch { /* war schon frei */ }
    this.sperre = null;
  }
}
