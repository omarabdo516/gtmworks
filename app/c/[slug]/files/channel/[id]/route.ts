import { supabase } from '@/lib/supabase';
import { companyFileResponse } from '@/lib/attachment-file';
import { routePermission } from '@/lib/route-permissions.mjs';

// A Member opens a file of one of their channel's messages (#156). Row-level security and the bucket's own policy show
// it only to a Member of that channel, so a Member outside it, a Member of another Company, and someone not signed in
// find nothing, as for a Card's or a Conversation's file.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string, id: string }> }) {
 const { slug, id } = await params;
 const db = await supabase();
 return companyFileResponse(db, slug, id, company => routePermission(db, 'app/c/[slug]/files/channel/[id]/route.ts', 'GET', company), { from: 'channel' });
}
