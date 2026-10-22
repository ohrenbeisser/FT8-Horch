// Zweisprachige Oberfläche: Texte nur in lang/*.json, Schlüssel flach, Platzhalter {name}.
const SPRACHEN = ['de', 'en'];
let texte = {};
let sprache = 'de';

export function erkenneSprache(gespeichert) {
  if (SPRACHEN.includes(gespeichert)) return gespeichert;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'de';
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export async function ladeSprache(code, basis = new URL('../lang/', import.meta.url)) {
  sprache = SPRACHEN.includes(code) ? code : 'de';
  const antwort = await fetch(new URL(`${sprache}.json`, basis));
  texte = await antwort.json();
  if (typeof document !== 'undefined') document.documentElement.lang = sprache;
  return sprache;
}

export const aktuelleSprache = () => sprache;

export function t(schluessel, werte = {}) {
  const roh = texte[schluessel] ?? schluessel;
  return roh.replace(/\{(\w+)\}/g, (_, k) => (k in werte ? String(werte[k]) : `{${k}}`));
}

// Zahl mit Dezimalzeichen der Sprache (6,25 Hz / 6.25 Hz)
export const zahl = (x, stellen = 2) => new Intl.NumberFormat(sprache, { maximumFractionDigits: stellen, useGrouping: false }).format(x);

// Setzt Texte für data-i18n (Textinhalt) und data-i18n-aria / data-i18n-title (Attribute)
export function uebersetzeSeite(wurzel = document) {
  for (const el of wurzel.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of wurzel.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of wurzel.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}
