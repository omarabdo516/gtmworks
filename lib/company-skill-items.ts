import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { supabaseConfig } from './supabase-config';
import { readCompanySkills, type SkillAgent } from './company-skills.mjs';

// The skills screen's Agents, each with the skills read now from its profile in the Engine (lib/company-skills.mjs).
// null when the Engine or the database cannot be read; it never rejects.
const skillService=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
export async function companySkillAgents(company:string):Promise<SkillAgent[]|null> {
 try { return await readCompanySkills(await supabase(),skillService(),{company}); }
 catch { return null; }
}
