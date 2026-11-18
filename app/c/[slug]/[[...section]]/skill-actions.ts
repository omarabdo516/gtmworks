'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanySkill } from '@/lib/company-skills.mjs';
import { answerRequest } from '@/lib/agent-requests.mjs';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
// A SKILL.md, uploaded or written, goes into the chosen Agent's own profile in the Engine (#343); lib/company-skills.mjs
// refuses anything else. The skill's text is never logged.
export const writeSkill=withActionLog('writeSkill',async function writeSkill(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const path=`/c/${String(form.get('slug'))}/skills`;
 const file=form.get('file'); const content=file instanceof File?(file.size>128*1024?'':await file.text()):String(form.get('content')||'');
 const {state}=!await actionAllowed(db,'writeSkill',company)?{state:'refused'}:await changeCompanySkill(db,createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),{company,agent:form.get('agent'),content});
 revalidatePath(path);
 if(state!=='written'&&!['invalid','shared','notOwn'].includes(state)) logActionFailure('writeSkill',{message:state},{});
 redirect(state==='written'?path:['invalid','shared','notOwn'].includes(state)?`${path}?refused=${state}`:`${path}?failed=1`);
});
// Only an Owner or a Manager decides a learning suggestion (#25), from their own item in "Waiting on you"; the database
// checks again, and an agent has no way to reach this action.
export const decideAgentRule=withActionLog('decideAgentRule',async function decideAgentRule(form:FormData) {
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/approvals`;
 const {error}=!await actionAllowed(db,'decideAgentRule',String(form.get('company')))?{error:{message:'not permitted'}}:await db.rpc('decide_agent_rule',{c:String(form.get('company')),item:Number(form.get('item')),approve:form.get('intent')==='approve'});
 revalidatePath(path);
 if(error) logActionFailure('decideAgentRule',error,{form});
 redirect(error?`${path}?failed=rule`:path);
});
// The reason is never logged: a failure line names only the action, the Company and the answer's state.
export const answerAgentRequest=withActionLog('answerAgentRequest',async function answerAgentRequest(form:FormData) {
 const db=await supabase(); const company=String(form.get('company')); const path=`/c/${String(form.get('slug'))}/approvals`;
 const state=!await actionAllowed(db,'answerAgentRequest',company)?'notAllowed':await answerRequest(db,{company,request:Number(form.get('request')),make:form.get('intent')==='make',reason:String(form.get('reason')||'')});
 revalidatePath(path);
 if(state!=='made'&&state!=='declined') logActionFailure('answerAgentRequest',{message:state},{form});
 redirect(state==='made'||state==='declined'?path:`${path}?failed=request-${state}`);
});
