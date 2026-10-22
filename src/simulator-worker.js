// Web Worker für den Simulator: ein Versuch je Nachricht, damit die Oberfläche nicht stockt.
// Nachricht herein: { id, params } wie bei simuliereVersuch. Nachricht heraus: { id, ergebnis } oder { id, error }.
import { simuliereVersuch } from './simulator.js';

self.onmessage = (ev) => {
  const { id, params } = ev.data;
  try {
    self.postMessage({ id, ergebnis: simuliereVersuch(params) });
  } catch (fehler) {
    self.postMessage({ id, error: String(fehler?.message ?? fehler) });
  }
};
