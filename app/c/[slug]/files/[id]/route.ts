import { supabase } from '@/lib/supabase';
import { attachmentFile } from '@/lib/attachment-file';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// A person opens a file of one of their companies' cards. Someone who is not a member of the company, or who is not signed in,
// finds nothing, exactly as for any other page of that company.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string, id: string }> }) {
 const { slug, id } = await params;
 const db = await supabase();
 const { data: company } = await db.from('companies').select('id').eq('slug', slug).maybeSingle();
 // The route's permission (lib/route-permissions.mjs): any Member of the company, read now.
 const allowed = company ? await routeAllowed(db, 'app/c/[slug]/files/[id]/route.ts', 'GET', company.id) : false;
 const response = allowed && company && /^\d+$/.test(id) ? await attachmentFile(db, company.id, Number(id)) : null;
 return response || new Response('Not found', { status: 404 });
}
