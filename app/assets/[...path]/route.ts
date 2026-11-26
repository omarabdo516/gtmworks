import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routePermission } from '@/lib/route-permissions.mjs';
import { askingSlug, dashboardAnswer } from '@/lib/engine-dashboard.mjs';

// The code of the Hermes dashboard's lazily loaded pages (#869), which they ask for at the root, /assets/<file>, not
// under the Company's path: served to the active Owner of the Company whose dashboard page asked for it (its Referer),
// and the missing page for everyone else and for a request no dashboard page made (lib/engine-dashboard.mjs).
export const dynamic='force-dynamic';
async function answer(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 return dashboardAnswer(request,{db,person:user?.id,slug:askingSlug(request.headers),pathname:request.nextUrl.pathname,search:request.nextUrl.search,code:true,
  allowed:company=>routePermission(db,'app/assets/[...path]/route.ts',request.method,company,user?.id)});
}
export { answer as GET, answer as HEAD };
