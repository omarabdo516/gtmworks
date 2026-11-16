import { supabase } from '@/lib/supabase';
import { attachmentFile } from '@/lib/attachment-file';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// A person opens a file of one of their own Conversations (#21). Row-level security shows it to that person alone, so
// another Member of the company, someone outside it, or someone not signed in finds nothing, as for a Card's file.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string, id: string }> }) {
 const { slug, id } = await params;
 const db = await supabase();
 const { data: company } = await db.from('companies').select('id').eq('slug', slug).maybeSingle();
 const allowed = company ? await routeAllowed(db, 'app/c/[slug]/files/conversation/[id]/route.ts', 'GET', company.id) : false;
 const response = allowed && company && /^\d+$/.test(id) ? await attachmentFile(db, company.id, Number(id), { from: 'conversation' }) : null;
 return response || new Response('Not found', { status: 404 });
}
