// Schublade (Navigation Drawer) der Horch-Apps: Öffnen und Schließen, Fokusfalle, Escape, `inert` im geschlossenen Zustand.
// Quelle: ~/dev/Apps/horch-basis. Erwartet #schublade, #scrim und #btnMenue im HTML; die Einträge sind Elemente mit der Klasse `sch-eintrag`.
// Ab `breite` Pixeln steht die Schublade dauerhaft (CSS in basis.css, Breite dort 1100 px).

export function initSchublade({ breite = 1100 } = {}) {
  const schublade = document.getElementById('schublade'), scrim = document.getElementById('scrim'), btnMenue = document.getElementById('btnMenue');
  const dauerhaft = () => matchMedia(`(min-width: ${breite}px)`).matches;
  const eintraege = () => [...schublade.querySelectorAll('.sch-eintrag')];
  const istOffen = () => schublade.classList.contains('offen');

  function oeffne() {
    if (dauerhaft()) return;
    schublade.classList.add('offen'); scrim.classList.add('offen');
    btnMenue.setAttribute('aria-expanded', 'true');
    schublade.removeAttribute('inert');
    (schublade.querySelector('[aria-current="page"]') ?? eintraege()[0])?.focus();
  }
  function schliesse(fokusZurueck = true) {
    if (!istOffen()) return;
    schublade.classList.remove('offen'); scrim.classList.remove('offen');
    btnMenue.setAttribute('aria-expanded', 'false');
    if (!dauerhaft()) schublade.setAttribute('inert', '');
    if (fokusZurueck) btnMenue.focus();
  }
  btnMenue.addEventListener('click', () => (istOffen() ? schliesse() : oeffne()));
  scrim.addEventListener('click', () => schliesse());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });
  schublade.addEventListener('click', (e) => { if (e.target.closest('.sch-eintrag')) schliesse(false); });
  // Tab bleibt in der offenen Schublade
  schublade.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !istOffen()) return;
    const f = eintraege();
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });
  matchMedia(`(min-width: ${breite}px)`).addEventListener('change', () => {
    schliesse(false);
    if (dauerhaft()) schublade.removeAttribute('inert'); else schublade.setAttribute('inert', '');
  });
  if (!dauerhaft()) schublade.setAttribute('inert', '');
  return { oeffne, schliesse, dauerhaft };
}
