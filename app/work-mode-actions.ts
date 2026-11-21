'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { inviteError } from '@/lib/invite.mjs';
import { inviteMember } from './invite-actions';
import type { FirstRunState } from '@/lib/first-run-choice';

type Row={id:number,email:string,role:string};
const roles=new Set(['manager','contributor','viewer']);
const refusals=new Set(['inviteEmailEmpty','inviteEmailMalformed','inviteEmailTaken']);

// First run (#9, #186): the Owner works alone or with a team. Alone opens the workspace at once; "With a team" is
// answered in a second step, and "team" is saved only when that step ends, by "Open the workspace" or "Skip". Opening
// with a team sends each row its invitation, the same one the Team table sends (#185: invite_member checks the Owner,
// the email and whether it is taken, and the invitation email goes out before the row is written), then opens the
// Owner's one Conversation with the main Agent. A refusal keeps the step open with its row's error and no answer
// saved; an invitation already sent by an earlier press is not sent again. A saved answer names the Conversation to open:
// the question leaves first and then goes there (#130).
export const chooseWorkMode=withActionLog('chooseWorkMode',async function chooseWorkMode(_state:FirstRunState,form:FormData):Promise<FirstRunState> {
 const company=form.get('company'), slug=form.get('slug'), choice=form.get('choice');
 if(typeof company!=='string'||typeof slug!=='string'||!/^[a-z0-9-]+$/.test(slug)) return {error:'firstRunFailed'};
 const db=await supabase();
 if(!await actionAllowed(db,'chooseWorkMode',company)) return {error:'firstRunFailed'};
 const save=async(mode:'alone'|'team'):Promise<{error:string}|{target:string}>=>{
  const {data:conversation,error}=await db.rpc('choose_work_mode',{c:company,mode});
  if(error) { logActionFailure('chooseWorkMode',error); return {error:'firstRunFailed'}; }
  return {target:conversation?`/c/${slug}/conversations/${conversation}`:`/c/${slug}/chat`};
 };
 if(choice==='alone'||choice==='skip') {
  const mode=choice==='alone'?'alone':'team';
  const saved=await save(mode);
  if('error' in saved) return saved;
  return {opened:`${saved.target}?first=${mode}${mode==='team'?'&invites=0':''}`};
 }
 if(choice!=='open') return {error:'firstRunFailed'};
 let rows:Row[], sent:string[];
 try { rows=JSON.parse(String(form.get('rows')||'[]')); sent=JSON.parse(String(form.get('sent')||'[]')); }
 catch { return {error:'firstRunFailed'}; }
 if(!Array.isArray(rows)||rows.length>50||!Array.isArray(sent)) return {error:'firstRunFailed'};
 // The invitations already sent, in the letter case the database keeps, are neither checked nor sent again.
 const already=new Set(sent.filter(email=>typeof email==='string').map(email=>email.trim().toLowerCase()));
 const rowErrors:Record<number,string>={};
 let firstError:number|undefined;
 const seen=new Set(already);
 const pending:{id:number,email:string,role:string}[]=[];
 rows.forEach((row,index)=>{
  const email=typeof row?.email==='string'?row.email.trim():'';
  const role=typeof row?.role==='string'?row.role:'';
  // A refusal comes back under the row's own id, so a row removed or moved above it cannot take it over (#186).
  const id=typeof row?.id==='number'&&Number.isSafeInteger(row.id)?row.id:index;
  if(!email||already.has(email.toLowerCase())) return;
  if(!roles.has(role)) { rowErrors[id]='inviteFailed'; firstError??=id; return; }
  const wrong=inviteError(email,[...seen]);
  if(wrong) { rowErrors[id]=wrong; firstError??=id; return; }
  seen.add(email.toLowerCase());
  pending.push({id,email,role});
 });
 if(firstError!==undefined) return {rowErrors,firstError,sent:[...already]};
 // The Owner, the address and whether it is taken are checked for every row before any email goes out, so a taken
 // row at the end sends none of the others.
 for(const row of pending) {
  const {error}=await db.rpc('invite_member',{c:company,mail:row.email,member_role:row.role,check_only:true});
  if(error) { rowErrors[row.id]=refusals.has(error.message)?error.message:'inviteFailed'; firstError??=row.id; }
 }
 if(firstError!==undefined) return {rowErrors,firstError,sent:[...already]};
 // Each invitation is the Team table's own: the same record, the same email and the same log row. One that cannot be
 // sent keeps the step open with its reason, and the ones that went are remembered so a second press sends only the rest.
 for(const row of pending) {
  const {error}=await inviteMember(company,slug,row.email,row.role);
  if(error) { rowErrors[row.id]=refusals.has(error)?error:'inviteFailed'; firstError??=row.id; }
  else already.add(row.email.toLowerCase());
 }
 if(firstError!==undefined) return {rowErrors,firstError,sent:[...already]};
 const saved=await save('team');
 if('error' in saved) return {...saved,sent:[...already]};
 return {opened:`${saved.target}?first=team&invites=${already.size}`,sent:[...already]};
});
