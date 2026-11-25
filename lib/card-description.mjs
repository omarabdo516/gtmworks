// A Card's description (#679, spec #668): Markdown text, read drawn. This module reads it without the editor: the to-do
// items with the lines they are on (the database's card_todos follows the same rules, so a tick names the same item the
// reader saw), the "2/5" count, the Markdown tree to draw, and the rules for what a link or an image may point at.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

const fenceLine = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const todoLine = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s+|$))(.*)$/;

/**
 * The to-do items of a description in reading order: the line each is on (1-based), its text after the box, and whether
 * it is ticked. A line inside a fenced code block is never one; a fence closes on a line of the same character, at least
 * as long, with nothing after it.
 * @param {string|null|undefined} body
 * @returns {{line:number,item:string,done:boolean}[]}
 */
export function todoItems(body) {
  const items = [];
  let fence = null;
  String(body || '').split('\n').forEach((text, index) => {
    const fenced = fenceLine.exec(text);
    if (fence) {
      if (fenced && fenced[1][0] === fence[0] && fenced[1].length >= fence.length && fenced[2].trim() === '') fence = null;
      return;
    }
    if (fenced) { fence = fenced[1]; return; }
    const todo = todoLine.exec(text);
    if (todo) items.push({ line: index + 1, item: todo[4].trim(), done: todo[2] !== ' ' });
  });
  return items;
}

/**
 * How many of a description's to-do items are ticked, of how many: what "2/5" says beside the list and on the tile.
 * @param {string|null|undefined} body
 * @returns {{done:number,total:number}}
 */
export function todoProgress(body) {
  const items = todoItems(body);
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/**
 * The Markdown tree of a description, GitHub's flavour (tables, to-do items, strikethrough, links written bare). Raw HTML
 * stays an `html` node, which is drawn as its own text, never rendered.
 * @param {string|null|undefined} body
 */
export function parseDescription(body) {
  return fromMarkdown(String(body || ''), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/**
 * Where a link in a description may lead: a web page (http, https), an email address, or a page of this app (a path
 * that starts with one "/"). Anything else (javascript:, data:, a file on the reader's machine) is no link and is drawn
 * as its text.
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function safeHref(url) {
  const value = String(url || '').trim();
  if (/^\/(?![/\\])/.test(value)) return value;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The picture a description may show: only a file in the Company's own storage, as the app serves it at
 * `/c/<slug>/files/<id>`. A picture from anywhere else is never loaded (the reader's address would reach that server);
 * it is drawn as its words instead.
 * @param {string|null|undefined} url
 * @param {string} slug the Company's address
 * @returns {string|null}
 */
export function companyImage(url, slug) {
  const value = String(url || '').trim();
  const match = /^\/c\/([^/?#]+)\/files\/(\d+)$/.exec(value);
  return match && match[1] === slug ? value : null;
}
