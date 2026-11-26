import type { SupabaseClient } from '@supabase/supabase-js';
export type AgentInstructionsPage={state:'found'|'missing'|'refused'|'unreachable'|'failed',own:boolean,instructions:string,sectionChars:number,limit:number};
type Refusal='tooLong'|'invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed';
export function readAgentInstructions(db:SupabaseClient,request:{company:string,agent:string}):Promise<AgentInstructionsPage|null>;
export function changeAgentInstructions(db:SupabaseClient,request:{company:string,agent:unknown,instructions:unknown}):Promise<{state:'written',instructions:string,sectionChars:number,limit:number}|{state:Refusal,instructions:null,sectionChars:number,limit:number}>;
