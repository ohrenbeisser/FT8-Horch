// Auto-Antwort: wählt aus den Signalen eines Decodierdurchgangs das erste CQ, auf das die App antworten darf.
// Übersprungen werden das eigene Rufzeichen, CQ mit Zusatz (CQ DX, CQ NA, ...: gerichtete Rufe) und Stationen, die
// laut Einstellung schon im Log stehen. modus: 'nie' (alles beantworten), 'heute' (nur UTC-Tag des Logeintrags),
// 'immer' (jede Station im Log).
import { parseMessage } from './qso.js';

const tag = (ms) => new Date(ms).toISOString().slice(0, 10);

export function schonImLogEingetragen(call, eintraege, modus, jetztMs) {
  if (modus === 'nie') return false;
  return eintraege.some((x) => x.dxCall === call && (modus === 'immer' || tag(x.completedAtMs ?? x.startedAtMs ?? 0) === tag(jetztMs)));
}

// signale: [{ text, ... }]. Rückgabe: { signal, cq } des ersten passenden CQ oder null
export function waehleAntwort(signale, { meinCall, eintraege = [], modus = 'heute', jetztMs = Date.now() }) {
  for (const signal of signale) {
    const cq = parseMessage(signal.text);
    if (cq.kind !== 'cq' || cq.modifier || cq.de === meinCall) continue;
    if (schonImLogEingetragen(cq.de, eintraege, modus, jetztMs)) continue;
    return { signal, cq };
  }
  return null;
}
