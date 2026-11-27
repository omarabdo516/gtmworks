import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routePermission } from '@/lib/route-permissions.mjs';
import { dashboardAnswer } from '@/lib/engine-dashboard.mjs';

// The Company's own Hermes dashboard (#869): every page, API route and code file under /c/<slug>/hermes, for an active
// Owner of that Company who is the install owner only (#915), and the missing page for everyone else (lib/engine-dashboard.mjs, the gate). Its sockets
// are the web server's (scripts/web-server.mjs).
export const dynamic='force-dynamic';
async function answer(request:NextRequest,{params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 return dashboardAnswer(request,{db,person:user?.id,slug,pathname:request.nextUrl.pathname,search:request.nextUrl.search,code:false,
  allowed:company=>routePermission(db,'app/c/[slug]/hermes/[[...path]]/route.ts',request.method,company,user?.id)});
}
export { answer as GET, answer as HEAD, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS };
