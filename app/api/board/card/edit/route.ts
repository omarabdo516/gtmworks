import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCompanyBoard } from '@/lib/company-board.mjs';
import { changeCompanyCard, type CardChange } from '@/lib/company-card-edit.mjs';

// A Card changed after it is made (spec #831, #837): one change a request, `{company, card, change}`, where `change` is a
// new title or description with the one it was changed from (`was`), a to-do ticked (`tick`), a column, a Card it waits
// for or no longer waits for, or its publishing date (lib/company-card-edit.mjs). An Owner, a Manager or a Contributor; a
// Viewer is refused here, before anything reaches the Engine, and a person who is no Member finds no such board. The
// request runs as the signed-in person, so the database checks the row's Role again (ADR 0004). A change answers with
// the board as it now reads; no answer names the Engine, its address, its key or a profile.
const file='app/api/board/card/edit/route.ts';
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failures:Record<string,[string,number]>={invalid:['cardInvalid',400],stale:['cardChanged',409],missing:['cardNotFound',404],noEngine:['boardNoEngine',503],
 unreachable:['boardUnreachable',503],failed:['boardUnreachable',503],notKept:['cardNotKept',500]};
// Why a move or a wait the Engine does not take was refused, in the words the board says it in.
const refusals:Record<string,string>={progress:'cardMoveProgress',waiting:'cardMoveWaiting',waits:'cardMoveWaits',link:'cardWaitRefused',engine:'cardMoveRefused'};

export async function PATCH(request:NextRequest) {
 try {
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'boardNotAllowed'},403);
  const raw=await request.text();
  let sent:Record<string,unknown>={};
  try { const parsed=raw.length>64000?null:JSON.parse(raw); if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)) sent=parsed; } catch { sent={}; }
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'boardNotAllowed'},401);
  const company=sent.company;
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'boardInvalid'},400);
  const allowed=await routePermission(db,file,'PATCH',company,user.id);
  if(allowed==='failed') return reply({error:'boardUnreachable'},503);
  if(allowed!=='allowed') {
   // A Member below the Role is refused; anyone else finds no such board, as the page answers them.
   const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
   return member?reply({error:'boardNotAllowed'},403):reply({error:'boardNotFound'},404);
  }
  const changed=await changeCompanyCard(db,{company,person:user.id,card:sent.card,change:sent.change as CardChange});
  if(changed.state==='changed') {
   const read=await readCompanyBoard(db,{company});
   return reply(read.state==='found'?{changed:sent.card,cards:read.cards,main:read.main}:{changed:sent.card});
  }
  if(changed.state==='refused') return reply({error:refusals[changed.why]},409);
  const [error,status]=failures[changed.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
