import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { readCompanyBoard } from '@/lib/company-board.mjs';
import { assignCompanyCard, cardChoices, dateCompanyCard, makeCompanyCard } from '@/lib/company-board-cards.mjs';

// New card and a Card's Assignee (spec #831, #836): GET is whom a Card may be given to (the Agents the reader sees, the
// Company's Members and the reader for "Assign to me"), POST makes a Card on the Company's Engine and PATCH gives one to
// an Agent, a Member or nobody (`assignee`), or sets or clears its publishing date (`publishOn`, #845), one of the two. An Owner, a Manager or a Contributor; a Viewer is refused here, before anything reaches
// the Engine, and a person who is no Member finds no such board. The request runs as the signed-in person, so the
// database checks the row's Role again (ADR 0004). A write answers with the board as it now reads, so the Card is drawn
// where the Engine put it; no answer names the Engine, its address, its key or a profile.
const file='app/api/board/cards/route.ts';
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failures:Record<string,[string,number]>={invalid:['cardInvalid',400],assigneeInvalid:['cardAssigneeInvalid',400],missing:['cardNotFound',404],busy:['cardBusy',409],
 noEngine:['boardNoEngine',503],unreachable:['boardUnreachable',503],failed:['boardUnreachable',503],notKept:['cardNotKept',500]};

async function body(request:NextRequest):Promise<Record<string,unknown>|null> {
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return null;
 const raw=await request.text(); if(raw.length>64000) return {};
 try { const parsed=JSON.parse(raw); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}; } catch { return {}; }
}
/** The signed-in person and whether their Role in the Company reaches this method: their id, or the answer to give. */
async function caller(db:Awaited<ReturnType<typeof supabase>>,method:'GET'|'POST'|'PATCH',company:unknown):Promise<{person:string}|{answer:NextResponse}> {
 const {data:{user}}=await db.auth.getUser();
 if(!user) return {answer:reply({error:'boardNotAllowed'},401)};
 if(typeof company!=='string'||!uuid.test(company)) return {answer:reply({error:'boardInvalid'},400)};
 const allowed=await routePermission(db,file,method,company,user.id);
 if(allowed==='failed') return {answer:reply({error:'boardUnreachable'},503)};
 if(allowed==='allowed') return {person:user.id};
 // A Member below the Role is refused; anyone else finds no such board, as the page answers them.
 const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 return {answer:member?reply({error:'boardNotAllowed'},403):reply({error:'boardNotFound'},404)};
}
async function board(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,extra:object) {
 const read=await readCompanyBoard(db,{company,me:person});
 return reply(read.state==='found'?{...extra,cards:read.cards,main:read.main}:extra);
}

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const company=request.nextUrl.searchParams.get('company');
  const who=await caller(db,'GET',company); if('answer' in who) return who.answer;
  const choices=await cardChoices(db,{company:company!,person:who.person});
  return choices?reply(choices):reply({error:'boardUnreachable'},503);
 } catch { return reply({error:'boardFailed'},500); }
}

export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const sent=await body(request);
  if(!sent) return reply({error:'boardNotAllowed'},403);
  const who=await caller(db,'POST',sent.company); if('answer' in who) return who.answer;
  const company=sent.company as string;
  const made=await makeCompanyCard(db,{company,person:who.person,key:sent.key,title:sent.title,description:sent.description,assignee:sent.assignee,publishOn:sent.publishOn});
  if(made.state==='made') return await board(db,company,who.person,{made:made.id});
  const [error,status]=failures[made.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}

export async function PATCH(request:NextRequest) {
 try {
  const db=await supabase(); const sent=await body(request);
  if(!sent) return reply({error:'boardNotAllowed'},403);
  const who=await caller(db,'PATCH',sent.company); if('answer' in who) return who.answer;
  const company=sent.company as string;
  const dating=Object.hasOwn(sent,'publishOn');
  if(dating===Object.hasOwn(sent,'assignee')) return reply({error:'cardInvalid'},400);
  if(dating) {
   const dated=await dateCompanyCard(db,{company,card:sent.card,publishOn:sent.publishOn});
   if(dated.state==='dated') return await board(db,company,who.person,{dated:sent.card});
   const [error,status]=failures[dated.state]; return reply({error},status);
  }
  const assigned=await assignCompanyCard(db,{company,card:sent.card,assignee:sent.assignee});
  if(assigned.state==='assigned') return await board(db,company,who.person,{assigned:sent.card});
  const [error,status]=failures[assigned.state]; return reply({error},status);
 } catch { return reply({error:'boardFailed'},500); }
}
