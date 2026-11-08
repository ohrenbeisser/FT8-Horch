// Audiogeräte wählen: Mikrofon (Eingang) und Lautsprecher (Ausgang). Die Wahl steht in den Einstellungen ('audioEingang' und
// 'audioAusgang', leer heißt Standardgerät) und gilt für QSO, Labor und Codierung (Hörproben). Dieselbe Datei nutzt SSTV-Horch.

/** Geräteliste aus enumerateDevices(): nur die gewünschte Art, ohne die virtuellen Einträge „default“ und „communications“ und ohne Einträge ohne Kennung (so meldet Chrome Geräte, solange die Erlaubnis fehlt). */
export function geraeteListe(geraete, art, ersatzname) {
  const liste = geraete.filter((g) => g.kind === art && g.deviceId && g.deviceId !== 'default' && g.deviceId !== 'communications');
  return liste.map((g, i) => ({ id: g.deviceId, label: g.label || `${ersatzname} ${i + 1}`, ohneName: !g.label }));
}

/** Kann der Browser den Ausgang eines AudioContext umschalten? (Chrome und Edge ja, Firefox bisher nicht.) */
export const ausgangWaehlbar = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

/** Stellt den Ausgang eines AudioContext ein (leere Kennung = Standardgerät). Fehlende Unterstützung oder ein fehlendes Gerät ist kein Fehler. Gibt zurück, ob umgeschaltet wurde. */
export async function setzeAusgang(ctx, id) {
  if (!ausgangWaehlbar() || typeof ctx?.setSinkId !== 'function') return false;
  try { await ctx.setSinkId(id || ''); return true; } catch { return false; }
}

/**
 * Öffnet das Mikrofon, mit raw (Vorgabe) ohne Echounterdrückung, Rauschunterdrückung und automatische Verstärkung. Mit Kennung wird genau dieses Gerät
 * verlangt (exact: ein bevorzugtes Gerät wird nicht überall beachtet). Fehlt es (abgesteckt), läuft das Standardgerät und
 * abweichung ist true. Andere Fehler, zum Beispiel verweigerte Erlaubnis, werden weitergereicht.
 */
export async function oeffneMikrofon(id, raw = true) {
  const basis = { echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: !raw, channelCount: 1 };
  if (id) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: { ...basis, deviceId: { exact: id } } }), abweichung: false };
    } catch (e) {
      if (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError') throw e;
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: basis }), abweichung: !!id };
}

/** Alle Geräte, wie der Browser sie meldet (Namen erscheinen erst nach erteilter Mikrofonerlaubnis). */
export const listeGeraete = async () => (navigator.mediaDevices?.enumerateDevices ? navigator.mediaDevices.enumerateDevices() : []);

/** Fragt einmal nach der Mikrofonerlaubnis, damit die Geräte ihre Namen zeigen, und gibt das Mikrofon sofort wieder frei. */
export async function entsperreGeraetenamen() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((x) => x.stop());
}
