import { isThumbnail } from './attachments.mjs';

// A file of an Agent's Library opened in the read-only preview (#195): what the dialog may draw, and how a CSV is cut
// into rows. The decision is made from the Engine's own type for the file, and a name only where the Engine hands back
// no useful type. A vector image, a page and a script are never drawn: they are downloaded, as `lib/attachments.mjs`
// already keeps every non-raster type off this origin.
const textTypes = ['text/plain', 'text/markdown', 'text/x-markdown'];
const tableTypes = ['text/csv'];
const textExtensions = ['txt', 'md', 'markdown'];
const tableExtensions = ['csv'];
const extensionOf = name => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
// The picture type a file's own name gives it, where the Engine's type is not at hand (a Library row carries a name
// only), and '' for a name that is not a raster the page draws.
const pictures = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/**
 * The raster type a file's name carries, or '' for anything else (a page, a vector image, a script): the same list
 * `isThumbnail` keeps, decided from the name where no Engine type came with the row.
 * @param {string} name
 * @returns {string}
 */
export function pictureType(name) { return pictures[extensionOf(name)] ?? ''; }

/**
 * The body a file gets in the preview: `image` for the raster types drawn inline, `text` for plain text and Markdown,
 * `table` for a CSV, and `none` for everything else — its icon and a Download, with no content of it in the answer.
 * @param {string} name @param {string} type
 * @returns {'image'|'text'|'table'|'none'}
 */
export function filePreviewKind(name, type) {
 if (isThumbnail(type)) return 'image';
 if (tableTypes.includes(type) || tableExtensions.includes(extensionOf(name))) return 'table';
 if (textTypes.includes(type) || textExtensions.includes(extensionOf(name))) return 'text';
 return 'none';
}

/**
 * A CSV's rows, the first `most` of them: one record a line, fields split on commas with a quoted field kept as one,
 * and a doubled quote inside it read as one quote. A carriage return at a line's end is dropped.
 * @param {string} text @param {number} [most]
 * @returns {string[][]}
 */
export function csvRows(text, most = 8) {
 const rows = []; let row = []; let field = ''; let quoted = false;
 for (let at = 0; at < text.length; at++) {
  const character = text[at];
  if (quoted) {
   if (character === '"' && text[at + 1] === '"') { field += '"'; at++; }
   else if (character === '"') quoted = false;
   else field += character;
  } else if (character === '"') quoted = true;
  else if (character === ',') { row.push(field); field = ''; }
  else if (character === '\n' || character === '\r') {
   if (character === '\r' && text[at + 1] === '\n') at++;
   row.push(field); field = '';
   rows.push(row); row = [];
   if (rows.length >= most) return rows;
  } else field += character;
 }
 if (field !== '' || row.length) { row.push(field); rows.push(row); }
 return rows.slice(0, most);
}
