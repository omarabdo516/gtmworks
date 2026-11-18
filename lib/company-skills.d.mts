import type { SupabaseClient } from '@supabase/supabase-js';
export type SkillAgent={id:string,name:string,own:boolean,skills:{name:string,shared:boolean,enabled:boolean}[]|null};
type Refusal='invalid'|'notOwn'|'shared'|'notAllowed'|'secret'|'noEngine'|'refused'|'unreachable'|'failed';
export function readCompanySkills(db:SupabaseClient,request:{company:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<SkillAgent[]|null>;
export function changeCompanySkill(db:SupabaseClient,request:{company:string,agent:unknown,content:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{state:'written'|Refusal,name:string|null}>;
export function changeCompanySkillEnabled(db:SupabaseClient,request:{company:string,agent:unknown,name:unknown,enabled:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{state:'changed'|Refusal,name:string|null}>;
export const skillProblems:Record<'invalid'|'shared'|'notOwn'|'notAllowed'|'secret',string>;
