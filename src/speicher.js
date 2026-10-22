// Dauerhafter Speicher: Ohne diese Zusage darf der Browser bei Platzmangel IndexedDB und localStorage der Seite löschen, also
// auch das Log. Chrome entscheidet ohne Rückfrage (installierte App, häufige Nutzung), Firefox fragt.
// Rückgabe: 'ja' (dauerhaft), 'nein' (darf gelöscht werden) oder 'unbekannt' (Browser kann es nicht sagen).

export async function speicherStatus(storage = globalThis.navigator?.storage) {
  try {
    if (!storage?.persisted) return 'unbekannt';
    return (await storage.persisted()) ? 'ja' : 'nein';
  } catch { return 'unbekannt'; }
}

export async function fordereDauerhaft(storage = globalThis.navigator?.storage) {
  try {
    if (!storage?.persist) return 'unbekannt';
    if (storage.persisted && await storage.persisted()) return 'ja';
    return (await storage.persist()) ? 'ja' : 'nein';
  } catch { return 'unbekannt'; }
}
