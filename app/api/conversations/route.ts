import { after, NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { companyEngine } from '@/lib/engine/handle.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { readModelAccess, offeredModels, modelEnabled } from '@/lib/provider-models.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { uuid } from '@/lib/conversations';
import { bodyLengthRefused, conversationFilesProblem, fileRefusal, maxRequestBytes } from '@/lib/attachments.mjs';
import type { PermissionChoice } from '@/lib/engine.mjs';
import { conversationMessagesPage, conversationUsage } from '@/lib/conversation-messages';
import { unarchiveOnWrite } from '@/lib/conversation-session-marks';
import { sendToEngine } from '@/lib/conversation-send';
import { answerEngineRun, permitEngineRun, stopEngineRun } from '@/lib/conversation-steer';

type Database=Awaited<ReturnType<typeof supabase>>;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refusals:Record<string,[string,number]>={P0002:['conversationNotFound',404],'42501':['conversationNotAllowed',403]};
const refuse=(error:string,status:number)=>reply({error},status);
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const refuseFor=(code:string|undefined)=>refuse(...(refusals[code||'']||['conversationFailed',500]));
const permissionChoices:readonly unknown[]=['once','always','deny'] satisfies PermissionChoice[];
// A Run the browser follows on a Conversation whose messages are the Engine's (#878), and an id the Engine gave what it
// waits on: lib/conversation-steer.ts checks both against the row and the Run's own record.
const runId=(value:unknown):value is string=>typeof value==='string'&&/^[\w.:-]{1,200}$/.test(value);
const askedId=(value:unknown):value is string=>typeof value==='string'&&/^[\w@-]{1,120}$/.test(value);
const steered=(done:object)=>'error' in done?refuse(String(done.error),Number((done as {status?:unknown}).status)||500):reply(done);

// A message is one Run on its Conversation's Engine session (#876, ADR 0033 item 1), started by lib/conversation-start.mjs
// once the database checked the send; nothing of it is stored here. This route only checks the request's shape and turns
// refusals into answers. Who wrote it is the signed-in person: no field of the request names an author, and any such
// field is ignored. A message names no Card (#846), and a send that names one is refused. Images go with the message
// (#155): the check runs before anything is sent, and they go in the Run's input and are kept nowhere here (#880).
// Nothing of the request is logged.
async function send(db:Database,person:string,body:Record<string,unknown>,chosen:File[]) {
 if(![body.conversation,body.sendKey].every(value=>typeof value==='string'&&uuid.test(value))||body.agent!==undefined&&(typeof body.agent!=='string'||!uuid.test(body.agent))) return refuse('conversationFailed',400);
 if(body.card!==undefined) return refuse('conversationFailed',400);
 if(body.rerun!==undefined&&body.rerun!==true&&body.rerun!=='true') return refuse('conversationFailed',400);
 if(body.messageId!==undefined&&!(typeof body.messageId==='number'&&Number.isSafeInteger(body.messageId)&&body.messageId>=0)&&!(typeof body.messageId==='string'&&/^\d{1,15}$/.test(body.messageId))) return refuse('conversationFailed',400);
 if(typeof body.message!=='string'||body.message.length>20000) return refuse('conversationFailed',400);
 // Try again on a Conversation whose last message is the person's with no reply (#980): a Run on that message, whose
 // words and own id the server checks against the session, never a second message stored.
 const rerun=body.rerun===true||body.rerun==='true';
 const messageId=typeof body.messageId==='string'?Number(body.messageId):body.messageId as number|undefined;
 // A file the Agent cannot read, more of them than a message carries, or a message whose text and images pass the
 // Engine's request limit: refused here, with one line saying why, and nothing is stored or sent.
 const problem=conversationFilesProblem(chosen,body.message);
 if(problem) return refuse(fileRefusal(problem),400);
 if(!chosen.length&&!body.message.trim()) return refuse('conversationFailed',400);
 const conversation=body.conversation as string;
 const messageKey=body.sendKey as string; const company=body.company as string;
 const engine=await sendToEngine(db,service(),{company,person,conversation,agent:body.agent as string|undefined,message:body.message,sendKey:messageKey,images:chosen,rerun,messageId});
 // A rerun whose message is no longer the Conversation's last: the page reads the session again, where the reply or
 // the newer message is.
 if(engine.state==='nothing') return reply({state:'nothing'});
 if(engine.state==='started') {
  // Writing in an archived Conversation brings it back (#881): its session's archived mark is cleared after the answer.
  after(async()=>{ try { await (await unarchiveOnWrite(db,company,conversation))?.(); } catch { /* It stays in the archive; the message was sent. */ } });
  return reply({conversation,...(engine.run?{run:engine.run}:{}),engine:true,...(engine.queued?{queued:true}:{})});
 }
 return engine.code?(engine.code==='22023'?refuse('conversationFailed',400):refuseFor(engine.code)):refuse(engine.error??'conversationFailed',engine.status??500);
}

// Stop (#878): the browser names the Run it follows, and only the Conversation's person stops it, with the Run's own
// stop (lib/conversation-steer.ts checks the Run against the row and the Run's own record).
async function stop(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!runId(body.run)) return refuse('conversationFailed',400);
 return steered(await stopEngineRun(db,{company:body.company as string,conversation:body.conversation,run:body.run}));
}

// An answer to the question the Agent's Run waits on (#138, #878): it names the Run and the question the Engine gave it,
// and is a pick (the choice's index, never its text), several picks on a question where several may be picked (#648), or
// the person's typed words, which go to the Run's own route. Only the Conversation's person answers.
async function answer(db:Database,body:Record<string,unknown>) {
 const isChoiceIndex=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<4;
 const picks=Array.isArray(body.choice)&&body.choice.length>=1&&body.choice.length<=4&&body.choice.every(isChoiceIndex)?body.choice as number[]:null;
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!runId(body.run)||!askedId(body.question)) return refuse('conversationFailed',400);
 const given=typeof body.text==='string'?(body.text.trim()&&body.text.length<=20000?{text:body.text}:null):isChoiceIndex(body.choice)?{pick:body.choice}:picks?{picks}:null;
 if(!given) return refuse('conversationFailed',400);
 return steered(await answerEngineRun(db,{company:body.company as string,conversation:body.conversation,run:body.run,question:body.question,answer:given}));
}

// A choice on the request the Agent's Run waits on (#163, #878): one of three fixed words, never text, naming the Run and
// the request the Engine gave it. Only the Conversation's person decides; "Always allow" from a Role that may not send
// it is refused (permission_choices) before the Engine is asked. Nothing of the request is logged.
async function permit(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!runId(body.run)||!askedId(body.permission)||!permissionChoices.includes(body.choice)) return refuse('conversationFailed',400);
 return steered(await permitEngineRun(db,{company:body.company as string,conversation:body.conversation,run:body.run,permission:body.permission,choice:body.choice as PermissionChoice}));
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
// Only the Conversation's person presses it, in that Conversation, while they may write (press_agent_access); the first
// press is kept with its time and any later one answers what the card already says. Nothing of the request is logged.
async function access(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)||!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)||typeof body.ask!=='boolean') return refuse('conversationFailed',400);
 const {data,error}=await db.rpc('press_agent_access',{c:body.company,conversation:body.conversation,request:body.card,ask:body.ask});
 if(error) return error.code==='22023'?refuse('conversationFailed',400):refuseFor(error.code);
 return reply(data as {state:string,at:string,first:boolean});
}

// The "+" menu's Model (#158): the Owner picks, for their own Conversation, one of the models its Agent's Engine offers,
// and every later Run of it is sent with it. The database refuses anyone else (set_conversation_model). The choice is a
// provider and a model; null goes back to the Agent's own.
async function pickModel(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)) return refuse('conversationFailed',400);
 // A model no Provider of the Company has switched on is not offered, so it is not kept either (#620). Only the Owner
 // picks (set_conversation_model checks it again), so anyone else is refused before the Providers are read.
 const choice=body.choice as {provider?:unknown,model?:unknown}|null|undefined;
 if(choice&&typeof choice==='object'&&typeof choice.provider==='string'&&typeof choice.model==='string') {
  if((await db.rpc('is_company_owner',{c:body.company})).data!==true) return refuse('conversationNotAllowed',403);
  const access=await readModelAccess(db,{company:body.company as string}).catch(()=>null);
  if(!access) return refuse('conversationFailed',503);
  if(!modelEnabled(access,{provider:choice.provider,model:choice.model})) return refuse('conversationModelNotEnabled',409);
 }
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
 const read=await (await companyEngine(company))?.on(pinned)?.models.read()||{state:'unreachable',current:null,models:[]};
 // Only the models a Provider of the Company has switched on, each once (#620).
 const access=read.state==='found'?await readModelAccess(db,{company}).catch(()=>null):null;
 return reply({state:read.state,models:offeredModels(read.models,access),current:found.model??read.current});
}

// A page of the Conversation's messages, read from its Agent's Engine session (#875): the last 50 when it opens, then
// the 50 before each time the person scrolls back. This is the messages' own request, never the page's (ADR 0030): the
// frame, the Agent and the composer are drawn without it, and the browser keeps the last page it read while this one
// answers. Only the Conversation's own person reads it (the row is read with their session, and named as theirs), and
// another Member of the Company or of another Company is answered not found as the row is. `none` is a Conversation
// with no Engine session yet, which holds no message.
async function messages(db:Database,person:string,company:string,conversation:string,offset:unknown,limit:unknown) {
 const from=typeof offset==='string'?Number.parseInt(offset,10):0;
 const size=typeof limit==='string'?Number.parseInt(limit,10):50;
 if(!Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(size)||size<1||size>50) return refuse('conversationFailed',400);
 const {data:found,error}=await db.from('conversations').select('id,agent_id,agent_name,hermes_session_id,lead_opening,person_id,created_at').eq('id',conversation).eq('company_id',company).eq('person_id',person).maybeSingle();
 if(error) return refuse('conversationUnread',503);
 if(!found) return refuse('conversationNotFound',404);
 const read=await conversationMessagesPage(db,company,found,{offset:from,limit:size}).catch(()=>null);
 if(!read) return refuse('conversationUnread',503);
 if(read.state==='notSeen') return refuse('conversationNotFound',404);
 return reply(read);
}

// The Conversation's token use (#347), its Engine session's detail read on its own request after the messages (ADR 0030).
// Only its own person asks; a session the Engine does not know is null, and the page keeps no usage line.
async function usage(db:Database,person:string,company:string,conversation:string) {
 const {data:found,error}=await db.from('conversations').select('id,agent_id,agent_name,hermes_session_id').eq('id',conversation).eq('company_id',company).eq('person_id',person).maybeSingle();
 if(error) return refuse('conversationUnread',503);
 if(!found) return refuse('conversationNotFound',404);
 return reply({usage:await conversationUsage(db,company,found).catch(()=>null)});
}

// Each write's intent and its handler; any other intent is a message to send.
const writes={stop,answer,permit,model:pickModel,later,access};

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
   // A form sends a text's line breaks as CRLF (the HTML form encoding), where the box and a JSON send keep the person's
   // own LF: the message is read back as they typed it (#880), so the Agent's words and the drawn ones are the same.
   const message=field('message')?.replace(/\r\n/g,'\n');
   body={company:field('company'),conversation:field('conversation'),sendKey:field('sendKey'),message,agent:field('agent'),intent:field('intent'),rerun:field('rerun'),messageId:field('messageId'),...(card!==undefined?{card:Number(card)}:{})};
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
  if(writing) return await (typeof body.intent==='string'&&Object.hasOwn(writes,body.intent)?writes[body.intent as keyof typeof writes](db,body):send(db,user.id,body,chosen));
  if(body.conversation===undefined) {
   // What the composer needs: whether this person may chat (any Member but a Viewer, #287), and the company's agents.
   const {data:writer}=await db.rpc('conversation_can_write',{c:body.company});
   const {data:agents}=writer?await db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',body.company).order('name'):{data:[]};
   return reply({writer:!!writer,agents:agents||[]});
  }
  if(body.intent==='read') return typeof body.conversation==='string'&&uuid.test(body.conversation)?await messages(db,user.id,body.company,body.conversation,body.offset,body.limit):refuse('conversationNotFound',404);
  if(body.intent==='usage') return typeof body.conversation==='string'&&uuid.test(body.conversation)?await usage(db,user.id,body.company,body.conversation):refuse('conversationNotFound',404);
  if(body.intent==='models') return typeof body.conversation==='string'&&uuid.test(body.conversation)?await models(db,user.id,body.company,body.conversation):refuse('conversationNotFound',404);
  return refuse('conversationFailed',400);
 } catch { logActionFailure('conversation',new Error('Conversation request failed')); return refuse('conversationFailed',400); }
}
export const GET=respond;
export const POST=respond;
