import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCompanyBoard } from '@/lib/company-board.mjs';

// The board's Cards (spec #831, #834): the Company's Engine's own Kanban board, read after the page has drawn its frame
// (ADR 0030). Any Member reads it, a Viewer included; anyone else finds no such board, as the page answers them. The
// request runs as the signed-in person, so a Card of an Agent hidden from them is not in the answer, and no answer names
// the Engine, its address, its key or a profile.
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'boardNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(!company||!uuid.test(company)) return reply({error:'boardInvalid'},400);
  const allowed=await routePermission(db,'app/api/board/route.ts','GET',company,user.id);
  if(allowed==='failed') return reply({error:'boardUnreachable'},503);
  if(allowed!=='allowed') return reply({error:'boardNotFound'},404);
  const read=await readCompanyBoard(db,{company});
  if(read.state==='found') return reply({cards:read.cards});
  return reply({error:read.state==='noEngine'?'boardNoEngine':'boardUnreachable'},503);
 } catch { return reply({error:'boardFailed'},500); }
}
