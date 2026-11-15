import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// The person who asked Lead for an Agent has opened it, so its "new" mark goes (#13). The page asks once it has
// mounted the Agent's chat or Settings page; server rendering and link prefetch never call this. The database clears
// the mark only for that Agent's requester, once (open_hermes_agent).
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'Session unavailable'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'Not allowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown}|null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)) return reply({error:'Invalid request'},400);
 if(!await routeAllowed(db,'app/api/agent-opened/route.ts','POST',body.company,user.id)) return reply({error:'Not allowed'},403);
 const {data,error}=await db.rpc('open_hermes_agent',{agent:body.agent});
 if(error) return reply({error:'Could not record it'},500);
 return reply({opened:data===true});
}
