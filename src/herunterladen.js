// Datei zum Herunterladen anbieten (Text oder Bytes). Alles bleibt lokal, es gibt keinen Server.
export function herunterladen(daten, dateiname, typ) {
  const url = URL.createObjectURL(new Blob([daten], { type: typ }));
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
