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
