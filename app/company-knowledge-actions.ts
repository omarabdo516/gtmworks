'use server';
import { withActionLog } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { saveKnowledge, type KnowledgeOutcome } from '@/lib/company-knowledge-skill.mjs';

// One part of the Company knowledge (#27), saved as the signed-in person into the shared Skill company-knowledge
// (#344, lib/company-knowledge-skill.mjs). check_company_knowledge checks the Role again, trims the text and refuses
// one that is too long or looks like a secret; each edit is logged. The text itself is never logged. Returns a message key.
export const saveCompanyKnowledge=withActionLog('saveCompanyKnowledge',async function saveCompanyKnowledge(company:string,part:string,body:string):Promise<KnowledgeOutcome> {
 const db=await supabase();
 if(!await actionAllowed(db,'saveCompanyKnowledge',company)) return 'companyKnowledgeNotAllowed';
 return saveKnowledge(db,{company,part,body});
});
