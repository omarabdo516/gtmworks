import 'server-only';
import { supabase } from './supabase';
import { readCompanySkills, type SkillAgent } from './company-skills.mjs';

// The skills screen's Agents, each with the skills read now from its profile in the Engine (lib/company-skills.mjs).
// null when the Engine or the database cannot be read; it never rejects.
export async function companySkillAgents(company:string):Promise<SkillAgent[]|null> {
 try { return await readCompanySkills(await supabase(),{company}); }
 catch { return null; }
}
