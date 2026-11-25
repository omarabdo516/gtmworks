import { clientErrorResponse } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';

// Errors the browser reports from its own pages, written to the container log (see lib/diagnostics.mjs). The limit counts
// per sender (#778): the signed-in person when the request carries a session, else the address it came from.
export const dynamic = 'force-dynamic';
async function sender(request: Request) {
  const address = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  if (!/(^|;\s*)sb-[^=]*-auth-token/.test(request.headers.get('cookie') || '')) return `address:${address}`;
  const { data } = await (await supabase()).auth.getClaims().catch(() => ({ data: null }));
  const person = data?.claims?.sub;
  return typeof person === 'string' ? `person:${person}` : `address:${address}`;
}
export async function POST(request: Request) {
  return clientErrorResponse(request, { sender: await sender(request) });
}
