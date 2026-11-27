import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCompanyBoard } from '@/lib/company-board.mjs';
import { archiveCompanyCards, readArchivedCards, restoreCompanyCards } from '@/lib/company-board-archive.mjs';

// The board's archive (spec #831, #842): GET is a page of the archived Cards (`from`, `q`), POST archives Cards and PATCH
// restores them, each on the Company's Engine with its own archived status, never its delete. Any Member reads the list;
// an Owner, a Manager or a Contributor archives and restores, and a Viewer is refused here, before anything reaches the
// Engine. A person who is no Member finds no such board. An archive of a Card an Agent works on, or one waiting on a
// person, answers 409 with what would stop until it is sent with `stop`. A write answers with the board as it now reads;
// no answer names the Engine, its address, its key or a profile.
const file='app/api/board/archive/route.ts';
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failures:Record<string,[string,number]>={invalid:['cardInvalid',400],noEngine:['boardNoEngine',503],refused:['boardUnreachable',503],unreachable:['boardUnreachable',503],failed:['boardUnreachable',503]};
type Db=Awaited<ReturnType<typeof supabase>>;

async function body(request:NextRequest):Promise<Record<string,unknown>|null> {
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return null;
 const raw=await request.text(); if(raw.length>64000) return {};
 try { const parsed=JSON.parse(raw); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}; } catch { return {}; }
}
/** The signed-in person may use this method in the Company, or the answer to give. */
async function allowed(db:Db,method:'GET'|'POST'|'PATCH',company:unknown):Promise<NextResponse|null> {
 const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'boardNotAllowed'},401);
 if(typeof company!=='string'||!uuid.test(company)) return reply({error:'boardInvalid'},400);
 const may=await routePermission(db,file,method,company,user.id);
 if(may==='failed') return reply({error:'boardUnreachable'},503);
 if(may==='allowed') return null;
 const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 return member?reply({error:'boardNotAllowed'},403):reply({error:'boardNotFound'},404);
}
async function board(db:Db,company:string,extra:object) {
 const read=await readCompanyBoard(db,{company});
 return reply(read.state==='found'?{...extra,cards:read.cards,main:read.main}:extra);
}

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const params=request.nextUrl.searchParams; const company=params.get('company');
  const refused=await allowed(db,'GET',company); if(refused) return refused;
  const read=await readArchivedCards(db,{company:company!,query:params.get('q')??'',from:params.get('from')??0});
  if(read.state==='found') return reply({cards:read.cards,total:read.total,next:read.next});
  const [error,status]=failures[read.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}

export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const sent=await body(request);
  if(!sent) return reply({error:'boardNotAllowed'},403);
  const refused=await allowed(db,'POST',sent.company); if(refused) return refused;
  const company=sent.company as string;
  const done=await archiveCompanyCards(db,{company,cards:sent.cards,stop:sent.stop});
  if(done.state==='archived') return await board(db,company,{archived:done.archived,left:done.left});
  if(done.state==='stops') return reply({error:'cardsStop',stops:done.stops},409);
  const [error,status]=failures[done.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}

export async function PATCH(request:NextRequest) {
 try {
  const db=await supabase(); const sent=await body(request);
  if(!sent) return reply({error:'boardNotAllowed'},403);
  const refused=await allowed(db,'PATCH',sent.company); if(refused) return refused;
  const company=sent.company as string;
  const done=await restoreCompanyCards(db,{company,cards:sent.cards,undo:sent.undo});
  if(done.state==='restored') return await board(db,company,{restored:done.restored,left:done.left});
  const [error,status]=failures[done.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
