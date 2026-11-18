import type { SupabaseClient } from '@supabase/supabase-js';
export type SkillAgent={id:string,name:string,own:boolean,skills:{name:string,shared:boolean}[]|null};
export function readCompanySkills(db:SupabaseClient,service:SupabaseClient,request:{company:string,encryptionKey:string|undefined,driver?:object}):Promise<SkillAgent[]|null>;
export function changeCompanySkill(db:SupabaseClient,service:SupabaseClient,request:{company:string,agent:unknown,content:unknown,encryptionKey:string|undefined,driver?:object}):Promise<{state:'written'|'invalid'|'notOwn'|'shared'|'noEngine'|'refused'|'unreachable'|'failed',name:string|null}>;
