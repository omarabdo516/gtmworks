'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanySkill, skillProblems } from '@/lib/company-skills.mjs';
import { answerRequest } from '@/lib/agent-requests.mjs';
import { answerChange } from '@/lib/agent-changes.mjs';
// Back to the skills screen: done, a refusal it names, or a failure, which is logged by its state only.
function skillsScreen(action:string,path:string,state:string,done:string) {
 revalidatePath(path);
 const refused=Object.hasOwn(skillProblems,state);
 if(state!==done&&!refused) logActionFailure(action,{message:state},{});
 redirect(state===done?path:refused?`${path}?refused=${state}`:`${path}?failed=1`);
}
// A SKILL.md, uploaded or written, goes into the chosen Agent's own profile in the Engine (#343); lib/company-skills.mjs
// refuses anything else, and the database checks the Role and the text again and logs the write. The text is never logged.
export const writeSkill=withActionLog('writeSkill',async function writeSkill(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const path=`/c/${String(form.get('slug'))}/skills`;
 const file=form.get('file'); const content=file instanceof File?(file.size>128*1024?'':await file.text()):String(form.get('content')||'');
 const {state}=!await actionAllowed(db,'writeSkill',company)?{state:'notAllowed'}:await changeCompanySkill(db,{company,agent:form.get('agent'),content});
 skillsScreen('writeSkill',path,state,'written');
});
// Only an Owner or a Manager decides a learning suggestion (#25), from their own item in "Waiting on you"; the database
// checks again, and an agent has no way to reach this action.
export const decideAgentRule=withActionLog('decideAgentRule',async function decideAgentRule(form:FormData) {
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/approvals`;
 const company=String(form.get('company')); const item=Number(form.get('item')); const approve=form.get('intent')==='approve';
 // The board's toast after the item leaves the list names its Agent (#169): the address carries the item's id, never the
 // Agent's name, and the board reads that name itself.
 const {error}=!await actionAllowed(db,'decideAgentRule',company)?{error:{message:'not permitted'}}:await db.rpc('decide_agent_rule',{c:company,item,approve});
 revalidatePath(path);
 if(error) logActionFailure('decideAgentRule',error,{form});
 redirect(error?`${path}?failed=rule`:`${path}?decided=${approve?'approve':'reject'}&item=${item}`);
});
// The reason is never logged: a failure line names only the action, the Company and the answer's state.
export const answerAgentRequest=withActionLog('answerAgentRequest',async function answerAgentRequest(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const path=`/c/${slug}/approvals`;
 const state=!await actionAllowed(db,'answerAgentRequest',company)?'notAllowed':await answerRequest(db,{company,request:Number(form.get('request')),make:form.get('intent')==='make',reason:String(form.get('reason')||'')});
 // An answer that makes an Agent changes the sidebar, which the Company's frame draws on every page: the frame is
 // refreshed, not only the page that answered, so the new Agent's tile is there wherever the person goes next (#298).
 revalidatePath(`/c/${slug}`,'layout');
 if(state!=='made'&&state!=='declined') logActionFailure('answerAgentRequest',{message:state},{form});
 redirect(state==='made'||state==='declined'?path:`${path}?failed=request-${state}`);
});

// A proposed change to an Agent's settings (#19): the Owner alone approves or declines it, from "Waiting on you" or the
// chat it was proposed in (`back`, a path inside this Company, where a done answer returns). Approving writes it to that Agent's own profile first
// (lib/agent-changes.mjs). The reason is never logged: a failure line names only the action and the answer's state.
export const answerAgentChange=withActionLog('answerAgentChange',async function answerAgentChange(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug'));
 // Only the two places a proposal is answered from, in this Company: never another path, however it is spelled.
 const back=String(form.get('back')||''); const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
 const place=/^[a-z0-9-]{1,100}$/.test(slug)&&new RegExp(`^/c/${slug}/(?:conversations/${uuid}|chat(?:/${uuid})?)$`).test(back);
 const path=place?back:`/c/${slug}/approvals`;
 // «Edit, then approve» (#484) sends the Owner's value as JSON: the database checks it as it checks a proposed value.
 const sent=form.get('edited'); const approve=form.get('intent')==='approve';
 // An edit that is too long, does not read, or reads as nothing is refused, never approved as proposed.
 const edited=!approve||typeof sent!=='string'?undefined:sent.length>100000?null:(()=>{ try { const value=JSON.parse(sent) as unknown; return value===null?null:{value}; } catch { return null; } })();
 const {state}=!await actionAllowed(db,'answerAgentChange',company)?{state:'notAllowed'}:edited===null?{state:'editInvalid'}
  :await answerChange(db,{company,proposal:Number(form.get('proposal')),approve,reason:String(form.get('reason')||''),...(edited?{edited:edited.value}:{})});
 // An approved model or setting changes what the Agent's settings page and the chat read: the whole frame is refreshed.
 revalidatePath(`/c/${slug}`,'layout');
 if(state!=='approved'&&state!=='declined') logActionFailure('answerAgentChange',{message:state},{form});
 // A failure is said where every Owner's answers wait, which names it.
 redirect(state==='approved'||state==='declined'?path:`/c/${slug}/approvals?failed=change-${state}`);
});

// A Member's request for an Agent hidden from them (#167): an Owner, or a Manager who sees that Agent, opens it for them
// (#15's switch) or says no, from their own item in "Waiting on you". answer_agent_access checks the Role and the Agent
// again; a failure line names only the action and the database's code.
export const answerAgentAccess=withActionLog('answerAgentAccess',async function answerAgentAccess(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const path=`/c/${slug}/approvals`;
 const {error}=!await actionAllowed(db,'answerAgentAccess',company)?{error:{code:'42501',message:'not permitted'}}
  :await db.rpc('answer_agent_access',{c:company,request:Number(form.get('request')),open:form.get('intent')==='open'});
 // An opening changes that Member's sidebar, which the Company's frame draws on every page.
 revalidatePath(`/c/${slug}`,'layout');
 if(error) logActionFailure('answerAgentAccess',{code:error.code,message:'answer_agent_access refused'});
 redirect(error?`${path}?failed=access`:path);
});
