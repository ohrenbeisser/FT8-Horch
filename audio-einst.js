// Einstellungen: Mikrofon (Eingang) und Lautsprecher (Ausgang) wählen. Leer heißt Standardgerät des Systems.
// Die Wahl steht in 'audioEingang' und 'audioAusgang' und wirkt beim nächsten Einschalten des Mikrofons (Eingang)
// beziehungsweise beim nächsten Ton (Ausgang). Die Kennungen gelten nur auf diesem Gerät und kommen nicht in die Sicherung.
import { geraeteListe, ausgangWaehlbar, listeGeraete, entsperreGeraetenamen } from './src/audiogeraete.js';

export function erzeugeAudioEinstellungen({ t, einstellung, setzeEinstellung }) {
  const $ = (id) => document.getElementById(id);
  const fuelle = (select, liste, gespeichert) => {
    select.replaceChildren();
    const neu = (text, wert) => { const o = document.createElement('option'); o.textContent = text; o.value = wert; select.append(o); };
    neu(t('settings.audio.standard'), '');
    for (const g of liste) neu(g.label, g.id);
    if (gespeichert && !liste.some((g) => g.id === gespeichert)) neu(t('settings.audio.fehlt'), gespeichert);
    select.value = gespeichert;
  };

  async function aktualisiere() {
    let geraete = [];
    try { geraete = await listeGeraete(); } catch { /* ohne Zugriff bleibt die Liste leer */ }
    const ein = geraeteListe(geraete, 'audioinput', t('settings.audio.mikro'));
    const aus = geraeteListe(geraete, 'audiooutput', t('settings.audio.ausgabe'));
    fuelle($('audioEingang'), ein, einstellung('audioEingang'));
    fuelle($('audioAusgang'), aus, einstellung('audioAusgang'));
    $('audioAusgang').disabled = !ausgangWaehlbar();
    $('audioAusgangNein').hidden = ausgangWaehlbar();
    $('audioFreigabe').hidden = ein.length > 0 && !ein.some((g) => g.ohneName); // Namen erscheinen erst nach der Mikrofonerlaubnis
  }

  $('audioEingang').addEventListener('change', () => setzeEinstellung('audioEingang', $('audioEingang').value));
  $('audioAusgang').addEventListener('change', () => setzeEinstellung('audioAusgang', $('audioAusgang').value));
  $('audioFreigabeKnopf').addEventListener('click', async () => {
    $('audioFreigabeFehler').textContent = '';
    try { await entsperreGeraetenamen(); } catch (err) { $('audioFreigabeFehler').textContent = t('settings.audio.entsperren.fehler', { grund: err.message || err.name }); }
    aktualisiere();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', aktualisiere);
  return { aktualisiere };
}
