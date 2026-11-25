import { waitResponse } from '@/lib/diagnostics.mjs';

// What a person waited for in a Conversation, as their browser measured it (#762, lib/diagnostics.mjs waitLine): one line
// in the container log, rate-limited as a client error is. Ids and whole milliseconds only, never a message.
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return waitResponse(request);
}
