// Hilfe-Seite: lädt die Anleitung als Markdown-Datei (help/hilfe.<Sprache>.md), wandelt sie mit src/markdown.js um und
// zeigt sie mit Inhaltsverzeichnis. Fehlt die Datei der Sprache, wird die deutsche gezeigt.
import { renderMarkdown } from './src/markdown.js';
import { aktuelleSprache, t } from './src/i18n.js';

const $ = (id) => document.getElementById(id);

async function ladeDatei(sprache) {
  const antwort = await fetch(new URL(`help/hilfe.${sprache}.md`, document.baseURI));
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.text();
}

export function erzeugeHilfeAnsicht() {
  const cache = new Map();

  function zumAbschnitt(ev) {
    const a = ev.target.closest('a[href^="#"]');
    if (!a) return;
    const ziel = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
    if (!ziel || !$('hilfeText').contains(ziel)) return;
    ev.preventDefault();
    const reduziert = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ziel.scrollIntoView({ behavior: reduziert ? 'auto' : 'smooth', block: 'start' });
  }

  async function zeige() {
    const sprache = aktuelleSprache();
    const text = $('hilfeText');
    let md = cache.get(sprache);
    if (md === undefined) {
      try {
        md = await ladeDatei(sprache);
      } catch {
        try { md = await ladeDatei('de'); } catch { md = null; }
      }
      cache.set(sprache, md);
    }
    $('hilfeNav').replaceChildren();
    if (md === null) {
      text.textContent = t('help.unavailable');
      $('hilfeInhalt').hidden = true;
      return;
    }
    const r = renderMarkdown(md, { bildBasis: 'help/' });
    text.innerHTML = r.html; // Der Leser maskiert alles und erzeugt nur eigene Tags
    const eintraege = r.toc.filter((x) => x.level === 2 || x.level === 3);
    $('hilfeInhalt').hidden = eintraege.length < 2;
    const ul = document.createElement('ul');
    for (const e of eintraege) {
      const li = document.createElement('li');
      li.className = `e${e.level}`;
      const a = document.createElement('a');
      a.href = `#${e.id}`;
      a.textContent = e.text;
      li.append(a);
      ul.append(li);
    }
    $('hilfeNav').append(ul);
  }

  $('hilfeText').addEventListener('click', zumAbschnitt);
  $('hilfeNav').addEventListener('click', zumAbschnitt);
  return { zeige };
}
