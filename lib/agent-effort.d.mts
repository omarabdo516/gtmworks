import type { SupabaseClient } from '@supabase/supabase-js';
export type EffortRefusal='invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed'|'mismatch';
export function changeAgentEffort(db:SupabaseClient,request:{company:string,agent:unknown,effort:unknown}):Promise<{state:'written',effort:string}|{state:EffortRefusal,effort:null}>;
