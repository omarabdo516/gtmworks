import type { SupabaseClient } from '@supabase/supabase-js';
type ProfileEngine=NonNullable<Awaited<ReturnType<typeof import('./engine/handle.mjs').agentEngine>>['engine']>;
export type AgentTarget={state:'found',profile:string,own:boolean,engine:ProfileEngine}|{state:'noEngine'|'noAgent'};
export function agentTarget(db:SupabaseClient,company:string,agent:string):Promise<AgentTarget>;
export function agentGate(db:SupabaseClient,request:{company:string,agent:unknown,check?:string,own?:boolean,missing?:'notOwn'|'notAllowed'}):Promise<
 |{state:'allowed',target:Extract<AgentTarget,{state:'found'}>}
 |{state:'invalid'|'noEngine'|'notOwn'|'notAllowed'|'failed'}>;
