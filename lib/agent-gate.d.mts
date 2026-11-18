import type { SupabaseClient } from '@supabase/supabase-js';
export type AgentTarget={state:'found',profile:string,own:boolean,address:string,key:string,managementAddress?:string}|{state:'noEngine'|'noAgent'};
export function agentTarget(db:SupabaseClient,company:string,agent:string,hermes:{address:string,key:string}|null):Promise<AgentTarget>;
export function agentGate(db:SupabaseClient,request:{company:string,agent:unknown,hermes?:{address:string,key:string}|null,check?:string,own?:boolean,missing?:'notOwn'|'notAllowed'}):Promise<
 |{state:'allowed',target:Extract<AgentTarget,{state:'found'}>}
 |{state:'invalid'|'noEngine'|'notOwn'|'notAllowed'|'failed'}>;
