'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { appUrl } from '@/lib/app-origin.mjs';
import { generateLinkSecret, inviteLink, linkSecretHash } from '@/lib/company-link.mjs';
import type { FirstRunLink, FirstRunState } from '@/lib/first-run-choice';

type Row={id:number,label:string,role:string};
const roles=new Set(['manager','contributor','viewer']);

// First run (#9, #186, #953): the Owner works alone or with a team. Alone opens the workspace at once; "With a team" is
// answered in a second step, and "team" is saved only when that step ends, by "Open the workspace" or "Skip". Opening
// with a team makes an Invite link for each Person named (ADR 0019: no email is sent), shows each once to copy, then
// opens the Owner's one Conversation with the main Agent. A refusal keeps the step open with its error and no answer
// saved. A saved answer names the Conversation to open: the question leaves first and then goes there (#130).
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
 let rows:Row[];
 try { rows=JSON.parse(String(form.get('rows')||'[]')); }
 catch { return {error:'firstRunFailed'}; }
 if(!Array.isArray(rows)||rows.length>50) return {error:'firstRunFailed'};
 // Each named Person gets an Invite link, made here with the Owner's own session (make_invite_links checks the Role
 // again and keeps only each hash), all in one call so a failure leaves no link made without its secret shown. A row
 // with no name is ignored, as an empty row was before.
 const named:{label:string,role:string}[]=[];
 for(const row of rows) {
  const label=typeof row?.label==='string'?row.label.trim():'';
  const role=typeof row?.role==='string'?row.role:'';
  if(!label) continue;
  if(label.length>120||!roles.has(role)||named.length>=50) return {error:'firstRunFailed'};
  named.push({label,role});
 }
 const secrets=named.map(()=>generateLinkSecret());
 if(named.length) {
  const {error}=await db.rpc('make_invite_links',{c:company,labels:named.map(row=>row.label),link_roles:named.map(row=>row.role),hashes:secrets.map(linkSecretHash)});
  if(error) { logActionFailure('chooseWorkMode',{code:error.code,message:'make_invite_links refused'}); return {error:'firstRunFailed'}; }
 }
 const links:FirstRunLink[]=named.map((row,index)=>({label:row.label,link:inviteLink(appUrl('/').origin,secrets[index])}));
 const saved=await save('team');
 if('error' in saved) return saved;
 return {opened:`${saved.target}?first=team&invites=${links.length}`,links};
});
