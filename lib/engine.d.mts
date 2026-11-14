import type { RunUsage } from './hermes.mjs';
export type EngineConnection={address:string,profile:string,key:string,managementAddress?:string};
export type RunState={state:'running'|'completed'|'failed'|'stopped'|'lost'|'unreachable',reply:string|null,session:string|null,usage:RunUsage|null};
export type Agent={name:string,instructions:string,model:string|null,ready:boolean};
export type AgentRequest={name:string,instructions:string,model?:string|null};
export type CreatedAgent={state:'created',agent:Agent}|{state:'exists'|'refused'|'unreachable'|'failed',agent:null};
export type FoundAgent={state:'found',agent:Agent}|{state:'missing'|'refused'|'unreachable',agent:null};
export type Engine={
 start(run:{conversation:string,input:string,idempotencyKey:string,instructions?:string}):Promise<string|null>,
 read(run:string):Promise<RunState>,
 stop(run:string):Promise<boolean>,
 createAgent(agent:AgentRequest):Promise<CreatedAgent>,
 readAgent(name:string):Promise<FoundAgent>,
};
export function engineFor(connection:EngineConnection):Engine;
export function outcomeOf(run:Pick<RunState,'state'|'reply'>):'completed'|'failed'|'stopped'|'lost'|null;
