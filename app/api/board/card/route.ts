import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCompanyCard } from '@/lib/company-card.mjs';

// A Card opened over the board (spec #831, #835): one task of the Company's Engine's own Kanban board, read whole after
// the window has drawn what the board already holds (ADR 0030). Any Member reads it, a Viewer included; anyone else, and
// a Card of an Agent hidden from the reader, finds no such Card. The request runs as the signed-in person, and no answer
// names the Engine, its address, its key or a profile.
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'cardNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company'); const card=request.nextUrl.searchParams.get('card');
  if(!company||!uuid.test(company)||!card||!/^[A-Za-z0-9_-]{1,64}$/.test(card)) return reply({error:'cardInvalid'},400);
  const allowed=await routePermission(db,'app/api/board/card/route.ts','GET',company,user.id);
  if(allowed==='failed') return reply({error:'cardUnreachable'},503);
  if(allowed!=='allowed') return reply({error:'cardNotFound'},404);
  const read=await readCompanyCard(db,{company,card});
  if(read.state==='found') return reply({card:read.card});
  if(read.state==='missing') return reply({error:'cardNotFound'},404);
  if(read.state==='invalid') return reply({error:'cardInvalid'},400);
  return reply({error:read.state==='noEngine'?'cardNoEngine':'cardUnreachable'},503);
 } catch { return reply({error:'cardFailed'},500); }
}
