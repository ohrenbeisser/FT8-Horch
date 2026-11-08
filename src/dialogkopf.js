// Schließen-Kreuz (x) oben rechts in jedem modalen Dialog. Einmal importieren; es greift bei showModal(), egal ob der Dialog
// im HTML steht oder per Skript entsteht. Die Beschriftung für Screenreader folgt der Seitensprache (<html lang>).
const TEXT = { de: 'Schließen', en: 'Close' };

const original = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function showModal(...args) {
  if (!this.querySelector(':scope > .dlg-kopf')) {
    const kopf = document.createElement('div');
    kopf.className = 'dlg-kopf';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'icon-btn dlg-x';
    b.textContent = '×'; // Zeichen statt Symbolschrift, damit nichts nachgeladen werden muss
    b.addEventListener('click', () => this.close());
    kopf.append(b);
    this.prepend(kopf);
  }
  const b = this.querySelector(':scope > .dlg-kopf > .dlg-x');
  const text = TEXT[(document.documentElement.lang || 'de').slice(0, 2)] ?? TEXT.en;
  b.setAttribute('aria-label', text); b.title = text;
  return original.apply(this, args);
};
