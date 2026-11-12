import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { fingerprint as requestFingerprint, hashKey, newKey } from '@/lib/agent-crypto.mjs';
import { authenticateAgent, type AgentSession } from '@/lib/agent-auth';
import { attachmentFile } from '@/lib/attachment-file';

async function handle(request: NextRequest, {params}:{params:Promise<{slug:string,path:string[]}>}) {
 const {slug,path}=await params;
 const key=request.headers.get('authorization')?.match(/^Bearer ((?:gtmw_agt_|gtmw_run_|agt_)[A-Za-z0-9_-]+)$/)?.[1];
 if (!key) return NextResponse.json({error:'unauthorized'},{status:401});
 let agent;
 try { agent=await authenticateAgent(key); } catch { return NextResponse.json({error:'authentication unavailable'},{status:503}); }
 if (!agent) return NextResponse.json({error:'unauthorized'},{status:401});
 // The old `agt_` company keys keep working during the transition; every answer to a known one says so.
 const mark=(response:NextResponse)=>{ if (key.startsWith('agt_')) { response.headers.set('Deprecation','true'); response.headers.set('X-GTMWorks-Key','legacy'); } return response; };
 if ('denied' in agent) return mark(NextResponse.json({error:'not found'},{status:404}));
 if (agent.limited) return mark(NextResponse.json({error:'rate limit exceeded'},{status:429,headers:{'Retry-After':'60'}}));
 return mark(await serve(request,slug,path,agent));
}
async function serve(request: NextRequest, slug: string, path: string[], agent: AgentSession) {
 const {db,company_id:c,person_id}=agent;
 const refuse=async (status=403)=>{ await db.rpc('log_agent_refusal',{c,k:agent.key_id,request_path:request.nextUrl.pathname}); return NextResponse.json({error:status===404?'not found':'forbidden'},{status}); };
 const writeError=async (error:{code:string,message:string})=>{
  if (error.message==='idempotency key reused') return NextResponse.json({error:'idempotency key reused'},{status:409});
  if (error.code==='42501' || /not permitted|cannot move beyond review|approval required|decision required|current approver controls|operation forbidden/.test(error.message)) return refuse();
  if (error.message.includes('not found')) return NextResponse.json({error:'not found'},{status:404});
  if (/^(22|23)/.test(error.code) || error.message==='invalid idempotency key') return NextResponse.json({error:'invalid request'},{status:400});
  return NextResponse.json({error:'write failed'},{status:500});
 };
 if (agent.slug!==slug) return refuse(404);
 const runCard=agent.run_card;
 // Skills come only from what the company stored and enabled for this agent; no request field, card or message can add instructions.
 // A skill read belongs to a run, so only a run key reads skills and its own loads; a company key is refused.
 if (path.length===1 && path[0]==='skills' && request.method==='GET') {
  if (!runCard) return refuse();
  const result=await db.rpc('agent_load_skills',{c,k:agent.key_id});
  if(result.error) return result.error.code==='42501' ? refuse() : NextResponse.json({error:'read failed'},{status:500});
  return NextResponse.json({skills:result.data});
 }
 if (path.length===1 && path[0]==='skill-loads' && request.method==='GET') {
  if (!runCard) return refuse();
  const result=await db.from('skill_loads').select('slug,version,sha256,loaded_at').eq('company_id',c).eq('key_id',agent.key_id).order('slug');
  if(result.error) return NextResponse.json({error:'read failed'},{status:500});
  return NextResponse.json({loads:result.data});
 }
 // An agent proposes a lesson for one of its skills from a run: the run's card is the card it was learned on. Nothing is added to the skill until a person approves it.
 if (path.length===3 && path[0]==='skills' && path[2]==='lessons' && request.method==='POST') {
  if (!runCard) return refuse();
  const idempotency=request.headers.get('idempotency-key');
  if (!idempotency || idempotency.length>200) return NextResponse.json({error:'idempotency key required'},{status:400});
  const raw=await request.text(); let payload;
  try { payload=JSON.parse(raw); if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error(); } catch { return NextResponse.json({error:'invalid JSON'},{status:400}); }
  const result=await db.rpc('propose_skill_lesson',{c,k:agent.key_id,skill_slug:path[1],req_key:idempotency,print:requestFingerprint(request.method,path.join('/'),raw),lesson_text:typeof payload.lesson==='string'?payload.lesson:'',why:typeof payload.reason==='string'?payload.reason:''});
  if(result.error) return writeError(result.error);
  return NextResponse.json(result.data,{status:201});
 }
 // A run key reaches its one card (and the list of that card) and nothing else; it can end itself but cannot issue keys or create cards.
 if (runCard && !(path[0]==='cards' && (path.length===1 ? request.method==='GET' : Number(path[1])===runCard && (path[2]!=='run-keys' || request.method==='DELETE')))) return refuse();
 if (path.length===1 && path[0]==='cards' && request.method==='GET') {
  if (request.nextUrl.searchParams.get('next_actor')!=='me') return NextResponse.json({error:'next_actor=me is required'},{status:400});
  const own=db.from('work_cards').select('*').eq('company_id',c);
  const result=await (runCard ? own.eq('id',runCard) : own.eq('next_actor',person_id));
  if(result.error) return result.error.code==='42501' ? refuse() : NextResponse.json({error:'read failed'},{status:500});
  const cards=await Promise.all((result.data || []).map(async (card: {id:number,stage_id:number})=>{
   const [stage,checklist,labels,creatives,versions,attachments]=await Promise.all([
    db.from('work_stages').select('*').eq('company_id',c).eq('id',card.stage_id).single(),
    db.from('work_checklist').select('*').eq('company_id',c).eq('card_id',card.id),
    db.from('work_card_labels').select('*,work_labels(*)').eq('company_id',c).eq('card_id',card.id),
    db.from('work_creatives').select('*').eq('company_id',c).eq('card_id',card.id),
    db.from('work_versions').select('*').eq('company_id',c).eq('card_id',card.id),
    db.from('work_attachments').select('id,comment_id,name,content_type,size,created_at').eq('company_id',c).eq('card_id',card.id).order('id')]);
   const signed=await Promise.all((versions.data || []).map(async (v: {id:number,path:string,creative_id:number})=>({...v,url:(await db.storage.from('creatives').createSignedUrl(v.path,3600)).data?.signedUrl || null})));
   return {...card,stage:stage.data,checklist:checklist.data,labels:labels.data,attachments:attachments.data||[],creatives:(creatives.data||[]).map((x: {id:number})=>({...x,versions:signed.filter(v=>v.creative_id===x.id)}))};
  }));
  return NextResponse.json({cards});
 }
 if (request.method==='GET' && path.length===4 && path[0]==='cards' && path[2]==='files' && /^\d+$/.test(path[1]) && /^\d+$/.test(path[3])) {
  // A run key got here only for its own card (the check above); a company key reads any card of its company. A file of another card or company is not found.
  const file=await attachmentFile(db,c,Number(path[3]),Number(path[1]));
  return file || NextResponse.json({error:'not found'},{status:404});
 }
 if (request.method==='POST' && path[0]==='cards' && path.length===3 && (path[2]==='upload' || (path[2]==='comment' && request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data'))) && /^\d+$/.test(path[1])) {
  const idempotency=request.headers.get('idempotency-key');
  if(!idempotency || idempotency.length>200) return NextResponse.json({error:'idempotency key required'},{status:400});
  let form:FormData; try { form=await request.formData(); } catch { return NextResponse.json({error:'invalid multipart body'},{status:400}); }
  const comment=path[2]==='comment'; const body=String(form.get('body') || '').trim();
  const file=form.get('file'); const creative=Number(form.get('creative') || 0); const evidence=String(form.get('evidence') || '');
  if(!(file instanceof File) || file.size===0 || file.size>20*1024*1024 || !Number.isSafeInteger(creative) || creative<0 || (comment && !body)) return NextResponse.json({error:'invalid file or creative'},{status:400});
  const card=Number(path[1]); const found=await db.from('work_cards').select('id').eq('company_id',c).eq('id',card).maybeSingle();
  if(!found.data) return refuse();
  const bytes=Buffer.from(await file.arrayBuffer()); const digest=createHash('sha256').update(bytes).digest('hex');
  const identity=JSON.stringify({digest,name:file.name,creative,evidence,body});
  const fingerprint=requestFingerprint(request.method,path.join('/'),identity);
  const storagePath=`${c}/${card}/${hashKey(`${person_id}:${idempotency}:${fingerprint}`)}`;
  const uploaded=await db.storage.from('creatives').upload(storagePath,bytes,{contentType:file.type || 'application/octet-stream',upsert:false});
  if(uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) return NextResponse.json({error:'upload failed'},{status:400});
  const payload=comment?{body,evidence:`file:${storagePath}`} : creative?{creative,path:storagePath,evidence}:{name:file.name,path:storagePath,evidence};
  const result=await db.rpc('agent_write',{c,request_key:idempotency,fingerprint,op:comment?'comment':creative?'version':'creative_with_version',card,payload});
  if(result.error) return writeError(result.error);
  return NextResponse.json(result.data,{status:comment?200:201});
 }
 if (request.method==='DELETE' && path.length===3 && path[0]==='cards' && path[2]==='run-keys' && /^\d+$/.test(path[1])) {
  // A run key ends itself; a company key ends every run key it issued for the card.
  const result=await db.rpc('revoke_run_keys',{c,card:Number(path[1]),run_key_id:runCard ? agent.key_id : null});
  if(result.error) return writeError(result.error);
  return NextResponse.json({revoked:result.data});
 }
 if (request.method==='POST' && path.length===3 && path[0]==='cards' && path[2]==='run-keys' && /^\d+$/.test(path[1])) {
  // An agent asks for a short-lived key for a card assigned to it. The key is shown here once; only its hash is stored.
  const body=await request.json().catch(()=>null); const issued=newKey('run'); const card=Number(path[1]);
  const result=await db.rpc('issue_run_key',{c,card,hash:issued.hash,ttl_seconds:body?.ttl_seconds ?? 3600});
  if(result.error) return writeError(result.error);
  return NextResponse.json({key:issued.key,card,expires_at:result.data},{status:201,headers:{'Cache-Control':'no-store'}});
 }
 if (request.method==='POST' || request.method==='PATCH') {
  const card=Number(path[1]);
  const op=path.length===1 && path[0]==='cards' && request.method==='POST' ? 'create' : path[0]==='cards' && Number.isSafeInteger(card) && card>0 ? (path.length===2 && request.method==='PATCH'?'edit':path.length===3 && request.method==='POST'?path[2]:'') : '';
  if (!['create','edit','move','actor','assignee','label','check','comment'].includes(op)) return refuse();
  const idempotency=request.headers.get('idempotency-key');
  if (!idempotency) return NextResponse.json({error:'idempotency key required'},{status:400});
  const raw=await request.text(); let payload;
  try { payload=JSON.parse(raw); if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error(); } catch { return NextResponse.json({error:'invalid JSON'},{status:400}); }
  const fingerprint=requestFingerprint(request.method,path.join('/'),raw);
  const result=await db.rpc('agent_write',{c,request_key:idempotency,fingerprint,op,card:card||null,payload});
  if(result.error) return writeError(result.error);
  return NextResponse.json(result.data,{status:op==='create'?201:200});
 }
 return refuse();
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const PUT=handle;
export const DELETE=handle;
