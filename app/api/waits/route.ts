import { waitResponse } from '@/lib/diagnostics.mjs';

// What a person waited for in a Conversation, as their browser measured it (#762, lib/diagnostics.mjs waitLine): one line
// in the container log, rate-limited per sender as a client error is (#778). Ids and whole milliseconds only, never a
// message.
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const address = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return waitResponse(request, { sender: `address:${address}` });
}
