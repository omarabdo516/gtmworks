import { after, NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { answerQuestion, closeOpenRuns, decidePermission, sendMessage, startQueuedTurns, stopConversationRun } from '@/lib/conversation-runs.mjs';
import { engineOf, onProfile } from '@/lib/company-engine.mjs';
import { engineFor } from '@/lib/engine.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { conversationColumns, uuid } from '@/lib/conversations';
import { bodyLengthRefused, conversationFilesProblem, fileRefusal, maxRequestBytes } from '@/lib/attachments.mjs';
import { conversationExists, discardConversationFiles, imagesOf, keepConversationFiles } from '@/lib/conversation-files';
import type { PermissionChoice } from '@/lib/engine.mjs';
import { conversationRecord } from '@/lib/conversation-record';
import { agentAppStates, agentSessionTurns } from '@/lib/company-app-items';

type Database=Awaited<ReturnType<typeof supabase>>;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refusals:Record<string,[string,number]>={P0002:['conversationNotFound',404],'42501':['conversationNotAllowed',403]};
const refuse=(error:string,status:number)=>reply({error},status);
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const refuseFor=(code:string|undefined)=>refuse(...(refusals[code||'']||['conversationFailed',500]));
const permissionChoices:readonly unknown[]=['once','always','deny'] satisfies PermissionChoice[];

// A message is checked, sent to the agent's engine and stored by lib/conversation-runs.mjs (through the engine
// contract, lib/engine.mjs); this route only checks the request's shape and turns refusals into answers. Who wrote it
// is the signed-in person: no field of the request names an author, and any such field is ignored.
// A first message from a Card's sheet names the Card (#145): the database starts the Card's chat with its Agent, or
// answers the caller's own chat already on it, and the message goes there.
// Images go with the message (#155): the check runs before anything is uploaded or sent, the images are read into the
// Agent's Run, and only a stored message keeps them (lib/conversation-files.ts). Nothing of the request is logged.
async function send(db:Database,body:Record<string,unknown>,chosen:File[]) {
 if(![body.conversation,body.sendKey].every(value=>typeof value==='string'&&uuid.test(value))||body.agent!==undefined&&(typeof body.agent!=='string'||!uuid.test(body.agent))) return refuse('conversationFailed',400);
 if(body.card!==undefined&&!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('conversationFailed',400);
 if(typeof body.message!=='string'||body.message.length>20000) return refuse('conversationFailed',400);
 // A file the Agent cannot read, more of them than a message carries, or a message whose text and images pass the
 // Engine's request limit: refused here, with one line saying why, and nothing is stored or sent.
 const problem=conversationFilesProblem(chosen,body.message);
 if(problem) return refuse(fileRefusal(problem),400);
 if(!chosen.length&&!body.message.trim()) return refuse('conversationFailed',400);
 let conversation=body.conversation as string;
 if(body.card!==undefined) {
  const {data:started,error}=await db.rpc('start_card_conversation',{c:body.company,card:body.card,conversation});
  if(error) return error.message==='cardChatTaken'?refuse('sheetChatTaken',409):refuseFor(error.code);
  conversation=started as string;
 }
 const images=chosen.length?await imagesOf(chosen):undefined;
 const messageKey=body.sendKey as string; const company=body.company as string;
 const files=()=>({company,conversation,messageKey});
 // A Conversation already there keeps its images before the Agent is asked, so a turn that has to wait behind another
 // Run is started with them, whenever the worker takes it. A new Conversation is never busy: its images go into its
 // first Run here, and are kept once its message is stored.
 const early=chosen.length>0&&await conversationExists(db,company,conversation);
 if(early) {
  const kept=await keepConversationFiles(db,service(),{...files(),files:chosen});
  if(kept.error) return refuse(kept.error,kept.error==='conversationFailed'?500:403);
 }
 const sent=await sendMessage(db,service(),{company,conversation,sendKey:messageKey,agent:body.card===undefined?body.agent as string|undefined:undefined,message:body.message,...(images?{images}:{})});
 // The engine refused the send: nothing was stored, so the images kept for it go too.
 if('code' in sent) { if(early) await discardConversationFiles(db,service(),files()); return refuseFor(sent.code); }
 if('error' in sent) { if(early) await discardConversationFiles(db,service(),files()); return refuse(sent.error,sent.status); }
 // A note to a person and an answer to a question store no message, so nothing can sit under one: their images go.
 if(early&&('addressed' in sent||'answered' in sent)) { await discardConversationFiles(db,service(),files()); return reply(sent); }
 // Kept only for a message that is stored, and for a new Conversation only now, when its row is there.
 if(chosen.length&&!early) {
  const kept=await keepConversationFiles(db,service(),{...files(),files:chosen});
  // The message is stored either way, so a retry with the same send key finds it and keeps the files then.
  if(kept.error) return refuse(kept.error,kept.error==='conversationFailed'?500:403);
 }
 return reply(sent);
}

// Stop works for the person who started the open run, or a Manager or Owner of the Company (the database decides).
async function stop(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)) return refuse('conversationFailed',400);
 const stopped=await stopConversationRun(db,{company:body.company as string,conversation:body.conversation});
 if('code' in stopped) return stopped.message==='conversationNothingToStop'?reply({stopped:false}):refuseFor(stopped.code);
 if('error' in stopped) return refuse(stopped.error,stopped.status);
 // The stopped run is closed now, and a turn waiting behind it may start.
 await closeOpenRuns(service(),{conversation:body.conversation});
 await startQueuedTurns(service(),{conversation:body.conversation});
 return reply(stopped);
}

// A pick on the question the Agent waits on (#138): the card and the choice's index, never its text, and one key per
// card on the page, so a second click is the same claim. Only the Conversation's person claims it (answer_question);
// the answer then goes to the waiting Run. Typed words answer it through send.
async function answer(db:Database,body:Record<string,unknown>) {
 if(![body.conversation,body.answerKey].every(value=>typeof value==='string'&&uuid.test(value))) return refuse('conversationFailed',400);
 if(!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)||!(typeof body.choice==='number'&&Number.isSafeInteger(body.choice)&&body.choice>=0&&body.choice<4)) return refuse('conversationFailed',400);
 const answered=await answerQuestion(db,service(),{company:body.company as string,conversation:body.conversation as string,card:body.card,choice:body.choice,answerKey:body.answerKey as string});
 if('code' in answered) return answered.code==='22023'?refuse('conversationFailed',400):refuseFor(answered.code);
 // Another tab or the Engine was first: the pick is not recorded, so the card says so and reads the record again.
 if(answered.state==='taken'||answered.state==='closed') return refuse(answered.state==='taken'?'questionTaken':'questionClosed',409);
 return reply({state:answered.state});
}

// "Done it" on a step an Agent handed over (#139): the person's own word, recorded once by the database with who and when
// (mark_hand_done), under the person's own session. gtmworks does not do the step and checks nothing outside. The first
// press also queues the person's turn that tells the Agent (#140). The press is answered once it is recorded; then, after
// the answer, Runs Hermes has ended are closed and the turn starts if the Agent is free, as a read does. A start that
// fails there is left to the worker and to the page's next read, which start waiting turns too.
async function done(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('conversationFailed',400);
 const {data,error}=await db.rpc('mark_hand_done',{c:body.company,conversation:body.conversation,card:body.card});
 if(error) return refuseFor(error.code);
 const {at,first}=data as {at:string,first:boolean};
 if(first) {
  const conversation=body.conversation;
  after(async()=>{
   try {
    await closeOpenRuns(service(),{conversation});
    await startQueuedTurns(service(),{conversation});
   } catch { logActionFailure('conversation',new Error('Handed step turn not started')); }
  });
 }
 return reply({state:'done',at,first});
}

// A choice on the request the Agent's Run waits on (#163): one of three fixed words, never text. Only the Conversation's
// person decides, with a choice their role may send and the Engine offered (decide_permission). The press is answered
// once the choice is kept, as "Done it" is, and the choice then goes to the waiting Run after the answer. A second
// press, another tab, or a request the Engine no longer waits on answers what the card shows now. Nothing of the
// request is logged.
async function permit(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('conversationFailed',400);
 if(!permissionChoices.includes(body.choice)) return refuse('conversationFailed',400);
 const decided=await decidePermission(db,service(),{company:body.company as string,conversation:body.conversation,card:body.card,choice:body.choice as PermissionChoice,later:after});
 if('code' in decided) return decided.code==='22023'?refuse('conversationFailed',400):refuseFor(decided.code);
 return reply(decided);
}

// "Later" on a connect card (#203): the Conversation's person, while an active Owner, puts off connecting the app the
// Agent asked for; the card stays postponed. The database checks both (postpone_app_card), writes no log row and
// changes nothing else. Connecting is #30's own route (/api/company-apps).
async function later(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('conversationFailed',400);
 const {data,error}=await db.rpc('postpone_app_card',{c:body.company,conversation:body.conversation,card:body.card});
 if(error) return refuseFor(error.code);
 return reply(data as {state:'postponed',first:boolean});
}

// A press on the card asking for an Agent hidden from its person (#167): "Ask" (ask true) or "No, never mind", never text.
// Only the Conversation's person presses it, while they may write (press_agent_access); the first press is kept with its
// time and any later one answers what the card already says. Nothing of the request is logged.
async function access(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)||typeof body.ask!=='boolean') return refuse('conversationFailed',400);
 const {data,error}=await db.rpc('press_agent_access',{c:body.company,request:body.card,ask:body.ask});
 if(error) return error.code==='22023'?refuse('conversationFailed',400):refuseFor(error.code);
 return reply(data as {state:string,at:string,first:boolean});
}

// The "+" menu's Model (#158): the Owner picks, for their own Conversation, one of the models its Agent's Engine offers,
// and every later Run of it is sent with it. The database refuses anyone else (set_conversation_model). The choice is a
// provider and a model; null goes back to the Agent's own.
async function pickModel(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)) return refuse('conversationFailed',400);
 const {data,error}=await db.rpc('set_conversation_model',{c:body.company,conversation:body.conversation,choice:body.choice??null});
 if(error) return error.code==='22023'?refuse('conversationFailed',400):refuseFor(error.code);
 return reply({model:data});
}

// The models the Owner may pick from for their own Conversation: the Engine's own list for its Agent's profile, and the
// one in use, the Conversation's choice or else the profile's own. Anyone else is answered as the database refuses them.
async function models(db:Database,person:string,company:string,conversation:string) {
 if((await db.rpc('is_company_owner',{c:company})).data!==true) return refuse('conversationNotAllowed',403);
 const {data:found}=await db.from('conversations').select('model,hermes_agents(profile)').eq('id',conversation).eq('company_id',company).eq('person_id',person).maybeSingle();
 const pinned=(found?.hermes_agents as {profile?:string}|null)?.profile;
 if(!found||!pinned) return refuse('conversationNotFound',404);
 const connection=onProfile(pinned,company,await engineOf(company,service()));
 const read=connection&&await engineFor(connection).models?.()||{state:'unreachable',current:null,models:[]};
 return reply({state:read.state,models:read.models,current:found.model??read.current});
}

// Reading the record also closes any of its runs Hermes has ended (lib/conversation-runs.mjs, as the worker does), so
// the page shows the reply, and the usage of every ended run, without a reload; then a turn that waited for that run
// starts. The person's session must see the conversation first; only their own runs of it are closed.
async function read(db:Database,person:string,company:string,conversation:string) {
 const {data:found}=await db.from('conversations').select(conversationColumns).eq('id',conversation).eq('company_id',company).maybeSingle();
 if(!found) return refuse('conversationNotFound',404);
 await closeOpenRuns(service(),{conversation,owner:person});
 await startQueuedTurns(service(),{conversation});
 return reply(await conversationRecord(db,person,company,found,agent=>agentAppStates(company,agent),(agent,session)=>agentSessionTurns(company,agent,session)));
}

// Each write's intent and its handler; any other intent is a message to send.
const writes={stop,answer,done,permit,model:pickModel,later,access};

async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('conversationNotFound',401);
  const writing=request.method==='POST';
  // A message with images goes as a form (#155): the same fields a text-only send posts in JSON, and the images as
  // `files`. Any other write is the JSON it always was; nothing of either is logged.
  const contentType=request.headers.get('content-type')||'';
  const form=writing&&contentType.startsWith('multipart/form-data');
  if(writing&&(!(contentType.startsWith('application/json')||form)||crossSiteWrite(request.headers))) return refuse('conversationNotAllowed',403);
  let body:Record<string,unknown>; let chosen:File[]=[];
  if(!writing) body=Object.fromEntries(request.nextUrl.searchParams);
  else if(form) {
   // A message the Engine could never take is refused before its bytes are read: one request is at most 10 MB, and a
   // chunked form, which declares no length, is refused too rather than read without a bound.
   if(bodyLengthRefused(request.headers.get('content-length'),maxRequestBytes)) return refuse('attachRequestRefused',413);
   const fields=await request.formData();
   const field=(name:string)=>{ const value=fields.get(name); return typeof value==='string'?value:undefined; };
   const card=field('card');
   body={company:field('company'),conversation:field('conversation'),sendKey:field('sendKey'),message:field('message'),agent:field('agent'),intent:field('intent'),...(card!==undefined?{card:Number(card)}:{})};
   // Every file is passed to the check, an empty one included: it is refused with the line, never silently dropped.
   chosen=fields.getAll('files').filter((file):file is File=>file instanceof File);
   if(chosen.length&&body.intent!==undefined) return refuse('conversationFailed',400);
  } else {
   const raw=await request.text(); if(raw.length>24000) return refuse('conversationFailed',400);
   body=JSON.parse(raw);
  }
  if(typeof body.company!=='string'||!uuid.test(body.company)) return refuse('conversationFailed',400);
  const {data:company}=await db.from('companies').select('id').eq('id',body.company).maybeSingle();
  if(!company) return refuse('conversationNotFound',404);
  // The route's permission (lib/route-permissions.mjs), with the role read now: a Viewer's send is refused here, and
  // the database refuses it again (conversation_can_write) before the engine is called.
  if(!await routeAllowed(db,'app/api/conversations/route.ts',request.method,body.company,user.id)) return refuse('conversationNotAllowed',403);
  if(writing) return await (typeof body.intent==='string'&&Object.hasOwn(writes,body.intent)?writes[body.intent as keyof typeof writes](db,body):send(db,body,chosen));
  if(body.conversation===undefined) {
   // What the composer needs: whether this person may chat (any Member but a Viewer, #287), and the company's agents.
   const {data:writer}=await db.rpc('conversation_can_write',{c:body.company});
   const {data:agents}=writer?await db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',body.company).order('name'):{data:[]};
   return reply({writer:!!writer,agents:agents||[]});
  }
  if(body.intent==='models') return typeof body.conversation==='string'&&uuid.test(body.conversation)?await models(db,user.id,body.company,body.conversation):refuse('conversationNotFound',404);
  return typeof body.conversation==='string'&&uuid.test(body.conversation)?await read(db,user.id,body.company,body.conversation):refuse('conversationNotFound',404);
 } catch { logActionFailure('conversation',new Error('Conversation request failed')); return refuse('conversationFailed',400); }
}
export const GET=respond;
export const POST=respond;
