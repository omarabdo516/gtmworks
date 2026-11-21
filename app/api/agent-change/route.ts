import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { readChangeContext } from '@/lib/agent-changes.mjs';

// What a proposed change's card reads when it is drawn (#484): the value the Agent has now, from its own Engine profile,
// and for an Owner the field to edit the proposal in. The proposal is read in the person's own session, so only someone
// who reads the card reads this; nothing is written.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'notAllowed'},401);
  const company=request.nextUrl.searchParams.get('company'); const proposal=Number(request.nextUrl.searchParams.get('proposal'));
  if(typeof company!=='string'||!uuid.test(company)||!Number.isSafeInteger(proposal)||proposal<1) return reply({error:'invalid'},400);
  if(!await routeAllowed(db,'app/api/agent-change/route.ts','GET',company,user.id)) return reply({error:'notAllowed'},403);
  const read=await readChangeContext(db,{company,proposal});
  return read.state==='notFound'?reply({error:'notFound'},404):reply(read);
 } catch { return reply({error:'failed'},502); }
}
