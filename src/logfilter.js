// Filter für die QSO-Liste im Log: Text (Rufzeichen, Locator, Notiz), Status und Datum (UTC, einschließlich).
const tagMs = (iso, ende) => Date.parse(`${iso}T${ende ? '23:59:59.999' : '00:00:00'}Z`);

export function filtereQsos(liste, { text = '', status = 'alle', von = '', bis = '' } = {}) {
  const such = text.trim().toLowerCase();
  const vonMs = von ? tagMs(von, false) : -Infinity;
  const bisMs = bis ? tagMs(bis, true) : Infinity;
  return liste.filter((r) => {
    if (status === 'bestaetigt' && !r.confirmed) return false;
    if (status === 'unbestaetigt' && r.confirmed) return false;
    const t = r.completedAtMs ?? 0;
    if (t < vonMs || t > bisMs) return false;
    if (!such) return true;
    return [r.dxCall, r.dxGrid, r.notiz].some((f) => f && String(f).toLowerCase().includes(such));
  });
}
