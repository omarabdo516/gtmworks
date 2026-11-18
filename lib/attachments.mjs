// Files and reference images on a card's messages. The limits match the agent API's uploads.
export const maxFiles = 5;
export const maxBytes = 20 * 1024 * 1024;

// Only these raster types are shown in the page. Anything else (a page, a vector image, a script) is downloaded,
// because a file a person uploaded must never run on our own origin.
const thumbnails = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** @param {string} type */
export const isThumbnail = type => thumbnails.includes(type);

/** @param {{name: string, content_type: string}} file */
export function attachmentHeaders({ name, content_type }) {
 const inline = isThumbnail(content_type);
 // RFC 5987: percent-encode every character a header value could mistake for syntax.
 const encoded = encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
 return {
  'Content-Type': inline ? content_type : 'application/octet-stream',
  'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Cache-Control': 'private, no-store',
 };
}

/** @param {{size: number}[]} files @returns {'count' | 'size' | null} */
export function filesProblem(files) {
 if (files.length > maxFiles) return 'count';
 if (files.some(file => file.size < 1 || file.size > maxBytes)) return 'size';
 return null;
}

// The Engine's own request limit (gateway/platforms/api_server.py `MAX_REQUEST_BYTES`, the pinned v0.23.0): one Run's
// body, its images included, is at most this many bytes.
export const maxRequestBytes = 10_000_000;
// The image kinds the Engine reads in a Run (#155). A file of another kind has no part on its API, so it is refused
// before anything is stored.
export const imageTypes = thumbnails;

// Base64 carries four bytes for every three, padded to a whole group.
const base64Length = size => Math.ceil(size / 3) * 4;
const textBytes = text => new TextEncoder().encode(text).length;

// What is wrong with the images chosen for a Conversation's message (#155), before anything is stored or sent: a file
// that is not one of the image kinds the Agent reads ('type'), more than maxFiles ('count'), one past the per-file size
// ('size'), or a message whose text and base64 images would pass the Engine's request limit ('request'). null when it
// can go. The composer and the route ask this same function, so the line a person reads and the refusal they get are
// one rule.
/** @param {{name?: string, size: number, content_type?: string, type?: string}[]} files @param {string} [text] @returns {'type' | 'count' | 'size' | 'request' | null} */
export function conversationFilesProblem(files, text = '') {
 const typed = files.map(file => ({ size: file.size, type: file.content_type || file.type || '' }));
 const problem = filesProblem(typed);
 if (problem) return problem;
 if (typed.some(file => !isThumbnail(file.type))) return 'type';
 const images = typed.reduce((sum, file) => sum + `data:${file.type};base64,`.length + base64Length(file.size), 0);
 return images + textBytes(text) > maxRequestBytes ? 'request' : null;
}
