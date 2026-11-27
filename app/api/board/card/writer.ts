import { NextRequest, NextResponse } from 'next/server';
import { uuid } from '@/lib/company-apps.mjs';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { readCompanyBoard } from '@/lib/company-board.mjs';

// The person who talks to the work on a Card (#838): the comment route and the Run route both take a JSON body from this
// site, from a signed-in person, naming a Company; each route then checks its own Role entry (lib/route-permissions.mjs),
// an Owner, a Manager or a Contributor. A Viewer is refused before anything reaches the Engine, and a person who is no
// Member finds no such board, as the page answers them.
export const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
type Db=Awaited<ReturnType<typeof supabase>>;
type Writer={db:Db,person:string,company:string,sent:Record<string,unknown>};

/** The signed-in person, their session, the Company and what they sent; or the answer to give them. */
export async function writing(request:NextRequest):Promise<Writer|{answer:NextResponse}> {
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return {answer:reply({error:'boardNotAllowed'},403)};
 const raw=await request.text();
 if(raw.length>64000) return {answer:reply({error:'cardInvalid'},400)};
 let sent:Record<string,unknown>={};
 try { const parsed=JSON.parse(raw); if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)) sent=parsed; } catch { /* an empty body, refused below */ }
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return {answer:reply({error:'boardNotAllowed'},401)};
 const company=sent.company;
 if(typeof company!=='string'||!uuid.test(company)) return {answer:reply({error:'boardInvalid'},400)};
 return {db,person:user.id,company,sent};
}

/** The answer for a person the route's Role entry does not allow, or null when it does. */
export async function notAllowed({db,person,company}:Writer,allowed:string) {
 if(allowed==='allowed') return null;
 if(allowed==='failed') return reply({error:'boardUnreachable'},503);
 const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',person).is('removed_at',null).maybeSingle();
 return member?reply({error:'boardNotAllowed'},403):reply({error:'boardNotFound'},404);
}

/** A write's answer with the board as it now reads for the person who wrote, so the Card is drawn where the Engine put it. */
export async function withBoard({db,company,person}:{db:Db,company:string,person:string},done:object) {
 const read=await readCompanyBoard(db,{company,me:person});
 return reply(read.state==='found'?{...done,cards:read.cards,main:read.main}:done);
}

// What each refusal of a Card's write answers.
export const refusals:Record<string,[string,number]>={invalid:['cardInvalid',400],missing:['cardNotFound',404],notAsking:['cardNotAsking',409],
 idle:['cardNotRunning',409],notStopped:['cardNotStopped',409],noEngine:['boardNoEngine',503],unreachable:['boardUnreachable',503],failed:['boardUnreachable',503]};
