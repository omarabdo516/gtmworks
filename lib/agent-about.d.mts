import type { SupabaseClient } from '@supabase/supabase-js';
export type AgentAbout={state:'found'|'missing'|'refused'|'unreachable'|'failed',own:boolean,displayName:string|null,description:string,descriptionAuto:boolean,botTitle:string|null};
type Refusal='invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed';
export function agentTarget(db:SupabaseClient,company:string,agent:string,hermes:{address:string,key:string}|null):Promise<{state:'found',profile:string,own:boolean,address:string,key:string}|{state:'noEngine'|'noAgent'}>;
export function readAgentAbout(db:SupabaseClient,request:{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<AgentAbout|null>;
export function changeAgentAbout(db:SupabaseClient,request:{company:string;agent:unknown,description:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{state:'written',description:string}|{state:Refusal,description:null}>;
export function agentTarget(db:SupabaseClient,company:string,agent:string,hermes:{address:string,key:string}|null):Promise<{state:'found',profile:string,own:boolean,address:string,key:string,managementAddress?:string}|{state:'noEngine'|'noAgent'}>;
