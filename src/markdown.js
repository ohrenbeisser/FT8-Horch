// Kleiner Markdown-Leser für die Hilfe. Kein Rohes HTML: Alles wird zuerst maskiert, danach kommen nur die hier
// erzeugten Tags dazu. Links sind nur http, https, mailto, Anker und relative Adressen erlaubt. Bilder nur als eigene
// Zeile (Abbildung mit optionaler Bildunterschrift) und nur als relative Datei (png, jpg, webp) ohne Ordnerwechsel;
// alles andere zeigt nur den Alternativtext. Unterstützt: Überschriften, Absätze, fett, kursiv, Code,
// Codeblöcke, Listen (auch verschachtelt), Zitate, Trennlinien, Tabellen, Links, Abbildungen.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slug(text) {
  const s = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'abschnitt';
}

const URL_ERLAUBT = /^(?:https?:\/\/|mailto:)/i;
const URL_ANKER = /^#[\w-]*$/;
const URL_RELATIV = /^(?![a-z][a-z0-9+.-]*:)[^\s]*$/i; // kein Schema vor dem ersten Doppelpunkt

function inline(roh) {
  const code = [];
  // Codestücke herausnehmen, damit darin nichts weiter ersetzt wird
  let s = esc(roh).replace(/`([^`]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, '$1'); // keine Bilder
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (URL_ERLAUBT.test(url)) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    if (URL_ANKER.test(url) || URL_RELATIV.test(url)) return `<a href="${url}">${text}</a>`;
    return text; // unbekanntes Schema (javascript:, data: …): nur der Text bleibt
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(?!\s)(.+?)(?<!\s)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[Number(i)]}</code>`);
}

// Erlaubte Bilddatei: relativ, nur Buchstaben, Ziffern, Punkt, Unterstrich, Minus und Schrägstrich, Endung png/jpg/webp
function bildPfad(src) {
  if (!/^[A-Za-z0-9._\-/]+$/.test(src) || src.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(src)) return null;
  return /\.(png|jpe?g|webp)$/i.test(src) ? src : null;
}

const klartext = (roh) => roh.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();

const ZEILE_LISTE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const BILDZEILE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/;
const TRENNLINIE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABELLEN_TRENNER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function zellen(zeile) {
  let z = zeile.trim();
  if (z.startsWith('|')) z = z.slice(1);
  if (z.endsWith('|')) z = z.slice(0, -1);
  return z.split('|').map((c) => c.trim());
}

function parseListe(zeilen, start) {
  const m0 = ZEILE_LISTE.exec(zeilen[start]);
  const einzug = m0[1].length;
  const geordnet = /\d/.test(m0[2]);
  let i = start;
  let html = '';
  while (i < zeilen.length) {
    const m = ZEILE_LISTE.exec(zeilen[i]);
    if (!m || m[1].length < einzug) break;
    if (m[1].length > einzug) {
      // Tiefer eingerückt: gehört als Unterliste zum letzten Eintrag
      const r = parseListe(zeilen, i);
      html = html.replace(/<\/li>$/, `${r.html}</li>`);
      i = r.naechste;
      continue;
    }
    html += `<li>${inline(m[3])}</li>`;
    i++;
  }
  const tag = geordnet ? 'ol' : 'ul';
  return { html: `<${tag}>${html}</${tag}>`, naechste: i };
}

function bloecke(zeilen, ctx) {
  const { toc, ids } = ctx;
  const aus = [];
  let i = 0;
  const beginntBlock = (z) => /^\s*```/.test(z) || /^#{1,6}\s/.test(z) || TRENNLINIE.test(z) || ZEILE_LISTE.test(z) || /^\s*>/.test(z);
  while (i < zeilen.length) {
    const z = zeilen[i];
    if (!z.trim()) { i++; continue; }
    if (/^\s*```/.test(z)) {
      const inhalt = [];
      i++;
      while (i < zeilen.length && !/^\s*```/.test(zeilen[i])) inhalt.push(zeilen[i++]);
      i++;
      aus.push(`<pre><code>${esc(inhalt.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(z);
    if (h) {
      const text = klartext(h[2]);
      let id = slug(text);
      const n = (ids.get(id) ?? 0) + 1;
      ids.set(id, n);
      if (n > 1) id = `${id}-${n}`;
      toc.push({ level: h[1].length, id, text });
      aus.push(`<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (TRENNLINIE.test(z)) { aus.push('<hr>'); i++; continue; }
    const bz = BILDZEILE.exec(z);
    if (bz) {
      const pfad = bildPfad(bz[2]);
      if (pfad) {
        const voll = `${ctx.bildBasis}${pfad}`;
        ctx.bilder.push(voll);
        aus.push(`<figure><img src="${esc(voll)}" alt="${esc(bz[1])}">${bz[3] ? `<figcaption>${inline(bz[3])}</figcaption>` : ''}</figure>`);
        i++;
        continue;
      }
    }
    if (/^\s*>/.test(z)) {
      const inhalt = [];
      while (i < zeilen.length && /^\s*>/.test(zeilen[i])) inhalt.push(zeilen[i++].replace(/^\s*>\s?/, ''));
      aus.push(`<blockquote>${bloecke(inhalt, { ...ctx, toc: [], ids: new Map() }).join('\n')}</blockquote>`);
      continue;
    }
    if (z.includes('|') && i + 1 < zeilen.length && TABELLEN_TRENNER.test(zeilen[i + 1])) {
      const kopf = zellen(z);
      i += 2;
      const zeilenHtml = [];
      while (i < zeilen.length && zeilen[i].includes('|') && zeilen[i].trim()) zeilenHtml.push(zellen(zeilen[i++]));
      aus.push(`<table><thead><tr>${kopf.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${zeilenHtml.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (ZEILE_LISTE.test(z)) {
      const r = parseListe(zeilen, i);
      aus.push(r.html);
      i = r.naechste;
      continue;
    }
    const absatz = [];
    while (i < zeilen.length && zeilen[i].trim() && !(absatz.length && beginntBlock(zeilen[i]))) absatz.push(zeilen[i++].trim());
    aus.push(`<p>${inline(absatz.join(' '))}</p>`);
  }
  return aus;
}

// bildBasis: Ordner, der vor relative Bildpfade gesetzt wird (zum Beispiel 'help/')
export function renderMarkdown(text, { bildBasis = '' } = {}) {
  const toc = [];
  const bilder = [];
  const zeilen = String(text).replace(/\r\n?/g, '\n').split('\n');
  const html = bloecke(zeilen, { toc, ids: new Map(), bilder, bildBasis }).join('\n');
  return { html, toc, bilder };
}
