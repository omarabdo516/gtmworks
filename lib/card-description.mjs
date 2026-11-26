// A Card's description (spec #831, #835): the Engine's task body, Markdown, read drawn as the approved Card draws it
// (design-reference-card: deParse, deIn, deRuns, deNum, deDir). One block per line, at most four list levels deep; the
// to-do items a person and the Agent tick are `- [ ]` and `- [x]` lines, counted above each run of them. Only the
// prototype's blocks are read: headings, paragraphs, quotes, bullets, numbers, to-dos, code, a divider, a picture and a
// table. Nothing is ever drawn as HTML: raw HTML is its own text, a link leads only to a web page or an email address,
// and a picture is never loaded (its words are drawn), so no description can make the reader's browser reach a server.

const maxLevel = 4;
const lists = new Set(['ul', 'ol', 'todo']);

/** @typedef {{t:'p'|'h1'|'h2'|'quote'|'ul'|'ol'|'todo'|'code', l:number, x:string, c?:boolean}|{t:'hr', l:number}|{t:'img', l:number, alt:string, src:string}|{t:'table', l:number, rows:string[][]}} Block */

const levelOf = (/** @type {string} */ indent) => Math.min(maxLevel, Math.floor(indent.replace(/\t/g, '  ').length / 2));
/** A list line sits at most one level under the line before it, and anything that is not a list line at level 0. @param {Block[]} list */
function clampLevels(list) {
  /** @type {Block|null} */ let previous = null;
  for (const block of list) {
    if (lists.has(block.t)) { const most = previous && lists.has(previous.t) ? previous.l + 1 : 0; block.l = Math.max(0, Math.min(block.l, most)); } else block.l = 0;
    previous = block;
  }
  return list;
}

/**
 * The description's blocks in reading order (design-reference-card: deParse).
 * @param {string|null|undefined} markdown @returns {Block[]}
 */
export function parseDescription(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  /** @type {Block[]} */ const out = []; /** @type {string[]|null} */ let paragraph = null; let i = 0;
  const flush = () => { if (paragraph) { out.push({ t: 'p', l: 0, x: paragraph.join('\n') }); paragraph = null; } };
  const cells = (/** @type {string} */ row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
  while (i < lines.length) {
    const raw = lines[i]; const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); i += 1; continue; }
    let m = line.match(/^\s*```(.*)$/);
    if (m) {
      flush(); const code = []; i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1; out.push({ t: 'code', l: 0, x: code.join('\n') }); continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) { flush(); out.push({ t: 'hr', l: 0 }); i += 1; continue; }
    m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (m) { flush(); out.push({ t: m[1].length === 1 ? 'h1' : 'h2', l: 0, x: m[2].replace(/\s+#+\s*$/, '') }); i += 1; continue; }
    m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (m) { flush(); out.push({ t: 'img', l: 0, alt: m[1], src: m[2] }); i += 1; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush(); const rows = [cells(line)]; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      const width = rows[0].length; for (const row of rows) { while (row.length < width) row.push(''); row.length = width; }
      out.push({ t: 'table', l: 0, rows }); continue;
    }
    m = line.match(/^\s*>\s?(.*)$/);
    if (m) { flush(); out.push({ t: 'quote', l: 0, x: m[1] }); i += 1; continue; }
    m = raw.match(/^(\s*)(?:[-*+•◦▪]|\d+[.)])\s+\[([ xX✓]?)\]\s?(.*)$/) || raw.match(/^(\s*)\[([ xX]?)\]\s+(.*)$/);
    if (m) { flush(); out.push({ t: 'todo', l: levelOf(m[1]), c: !!m[2].trim(), x: m[3].replace(/\s+$/, '') }); i += 1; continue; }
    m = raw.match(/^(\s*)[-*+•◦▪]\s+(.*)$/);
    if (m) { flush(); out.push({ t: 'ul', l: levelOf(m[1]), x: m[2].replace(/\s+$/, '') }); i += 1; continue; }
    m = raw.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (m) { flush(); out.push({ t: 'ol', l: levelOf(m[1]), x: m[2].replace(/\s+$/, '') }); i += 1; continue; }
    (paragraph = paragraph || []).push(line.trim()); i += 1;
  }
  flush();
  return clampLevels(out);
}

/** The number a numbered line shows: its place among the numbered lines of its level in its run (deNum). @param {Block[]} list @param {number} at */
export function numberOf(list, at) {
  const block = list[at]; let n = 1;
  for (let j = at - 1; j >= 0; j -= 1) {
    const other = list[j]; if (!lists.has(other.t) || other.l < block.l) break;
    if (other.l === block.l) { if (other.t === 'ol') n += 1; else break; }
  }
  return n;
}

/**
 * Each run of to-do items, by the index of its first line: how many of its items are ticked, of how many (deRuns). A run
 * is consecutive to-dos, with any list line nested under them.
 * @param {Block[]} list @returns {Map<number,{done:number,total:number}>}
 */
export function todoRuns(list) {
  const runs = new Map(); /** @type {{done:number,total:number}|null} */ let current = null;
  list.forEach((block, at) => {
    if (block.t === 'todo') {
      if (!current) { current = { done: 0, total: 0 }; runs.set(at, current); }
      current.total += 1; if (block.c) current.done += 1; return;
    }
    if (current && lists.has(block.t) && block.l > 0) return;
    current = null;
  });
  return runs;
}

/** How many of the description's to-do items are ticked, of how many. @param {string|null|undefined} markdown */
export function todoCount(markdown) {
  const items = parseDescription(markdown).filter(block => block.t === 'todo');
  return { done: items.filter(block => block.c).length, total: items.length };
}

/**
 * A line's direction is its main language, not its first letter: words are counted, and links, code and mentions do not
 * count (deDir). Empty when it has no word.
 * @param {string} value @returns {'rtl'|'ltr'|''}
 */
export function lineDirection(value) {
  const words = String(value || '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '').replace(/`[^`]*`/g, '').replace(/[@#]\S+/g, '').match(/[A-Za-z؀-ۿ]+/g);
  if (!words) return '';
  const arabic = words.filter(word => /[؀-ۿ]/.test(word)).length; const other = words.length - arabic;
  return arabic > other ? 'rtl' : other > arabic ? 'ltr' : /[؀-ۿ]/.test(words[0]) ? 'rtl' : 'ltr';
}

/** @typedef {{t:'text',v:string}|{t:'code',v:string}|{t:'br'}|{t:'b'|'s'|'i',in:Inline[]}|{t:'a',href:string|null,in:Inline[]}} Inline */
// deIn's tokens: an escaped character, inline code, a link, bold, struck, italic, a line break.
const inlinePattern = /\\([\\`*_~[\]()#>|!.\-+])|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^\n]+?)\*\*|~~([^\n]+?)~~|\*([^\s*](?:[^\n*]*?[^\s*])?)\*|<br\s*\/?>/g;
/** Where a link may lead: a web page or an email address; anything else is drawn as its words. @param {string} url */
const safeHref = url => /^(https?:|mailto:)/i.test(url) ? url : null;

/** A line's inline Markdown as a tree of text, code, bold, struck, italic, links and breaks (deIn). @param {string} value @returns {Inline[]} */
export function parseInline(value) {
  const source = String(value || ''); /** @type {Inline[]} */ const out = []; let last = 0;
  const text = (/** @type {string} */ part) => { if (part) out.push({ t: 'text', v: part }); };
  for (const m of source.matchAll(inlinePattern)) {
    const at = m.index ?? 0;
    text(source.slice(last, at)); last = at + m[0].length;
    if (m[1] != null) text(m[1]);
    else if (m[2] != null) out.push({ t: 'code', v: m[2] });
    else if (m[3] != null) out.push({ t: 'a', href: safeHref(m[4]), in: parseInline(m[3]) });
    else if (m[5] != null) out.push({ t: 'b', in: parseInline(m[5]) });
    else if (m[6] != null) out.push({ t: 's', in: parseInline(m[6]) });
    else if (m[7] != null) out.push({ t: 'i', in: parseInline(m[7]) });
    else out.push({ t: 'br' });
  }
  text(source.slice(last));
  return out;
}
