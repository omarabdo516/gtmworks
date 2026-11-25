// A request body read only up to a limit (#778). A route that needs no sign-in checks the declared length first and
// refuses a body over the limit without reading a byte of it; a body that declares no length is read until it passes the
// limit and no further. So no request can make the server hold more than the limit in memory.
export async function cappedBody(request, max) {
  const declared = request.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= max)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
  return bytes;
}

// A form posted to a route that needs no sign-in, read through cappedBody: null when it is over the limit.
export async function cappedForm(request, max) {
  const bytes = await cappedBody(request, max);
  if (!bytes) return null;
  return new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
}
