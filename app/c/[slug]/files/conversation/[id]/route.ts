import { supabase } from '@/lib/supabase';
import { companyFileResponse } from '@/lib/attachment-file';
import { routePermission } from '@/lib/route-permissions.mjs';

// A person opens a file of one of their own Conversations (#21). Row-level security shows it to that person alone, so
// another Member of the company, someone outside it, or someone not signed in finds nothing, as for a Card's file.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string, id: string }> }) {
 const { slug, id } = await params;
 const db = await supabase();
 return companyFileResponse(db, slug, id, company => routePermission(db, 'app/c/[slug]/files/conversation/[id]/route.ts', 'GET', company), { from: 'conversation' });
}
