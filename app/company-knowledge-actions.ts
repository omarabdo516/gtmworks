'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';

const refusals=['companyKnowledgeNotAllowed','companyKnowledgeInvalid','companyKnowledgeTooLong','companyKnowledgeSecret'] as const;
type Refusal=typeof refusals[number];
type KnowledgeOutcome='companyKnowledgeSaved'|'companyKnowledgeCleared'|'companyKnowledgeUnchanged'|Refusal|'companyKnowledgeFailed';

// One part of the Company knowledge (#27), saved as the signed-in person. save_company_knowledge checks the Role again,
// trims the text, refuses one that is too long or looks like a secret, and logs the edit; an empty text clears the part,
// and the same text as stored changes nothing. The text itself is never logged. Returns a message key.
export const saveCompanyKnowledge=withActionLog('saveCompanyKnowledge',async function saveCompanyKnowledge(company:string,part:string,body:string):Promise<KnowledgeOutcome> {
 const db=await supabase();
 if(!await actionAllowed(db,'saveCompanyKnowledge',company)) return 'companyKnowledgeNotAllowed';
 if(typeof part!=='string'||typeof body!=='string') return 'companyKnowledgeInvalid';
 const {data:changed,error}=await db.rpc('save_company_knowledge',{c:company,part,body});
 if(error&&(refusals as readonly string[]).includes(error.message)) return error.message as Refusal;
 if(error) { logActionFailure('saveCompanyKnowledge',{code:error.code,message:'save_company_knowledge refused'}); return 'companyKnowledgeFailed'; }
 // An empty text after the characters save_company_knowledge trims clears the part.
 return !changed?'companyKnowledgeUnchanged':/[^ \t\r\n]/.test(body)?'companyKnowledgeSaved':'companyKnowledgeCleared';
});
