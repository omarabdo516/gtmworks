import { clientErrorResponse } from '@/lib/diagnostics.mjs';

// Errors the browser reports from its own pages, written to the container log (see lib/diagnostics.mjs).
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return clientErrorResponse(request);
}
