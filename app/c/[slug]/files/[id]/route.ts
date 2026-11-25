import { supabase } from '@/lib/supabase';
import { companyFileResponse } from '@/lib/attachment-file';
import { routePermission } from '@/lib/route-permissions.mjs';

// A person opens a file of one of their companies' cards. Someone who is not a member of the company, or who is not signed in,
// finds nothing, exactly as for any other page of that company.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string, id: string }> }) {
 const { slug, id } = await params;
 const db = await supabase();
 return companyFileResponse(db, slug, id, company => routePermission(db, 'app/c/[slug]/files/[id]/route.ts', 'GET', company), { from: 'card' });
}
