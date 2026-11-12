// The setup link carries its one-time code after `#` (issue #50, Omar 2026-11-12). A browser never sends the fragment
// in a request, so no proxy or server request log receives the code; the page reads it here and sends it only in the
// body of the submit request. This file runs in the browser too, so it imports nothing.
export const setupLink=(origin,code)=>`${origin}/first-run#code=${code}`;
export const setupCodeFromHash=hash=>hash.startsWith('#') && new URLSearchParams(hash.slice(1)).get('code') || undefined;
