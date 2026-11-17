import type { RunUsage } from './hermes.mjs';
export type EngineConnection={address:string,profile:string,key:string,managementAddress?:string};
export type JsonSchemaObject={type:'object',properties:Record<string,unknown>,required?:string[],additionalProperties?:boolean};
export type ToolSpec={name:string,description:string,parameters:JsonSchemaObject};
export type ToolCall={id:string,name:string,arguments:unknown};
export type HistoryEntry={role:'user'|'assistant',content:string};
export type RunQuestion={id:string,text:string,choices:string[],multiple:boolean};
export type PermissionChoice='once'|'always'|'deny';
export type RunPermission={id:string,description:string,command:string,choices:PermissionChoice[]};
export type RunState={state:'running'|'completed'|'failed'|'stopped'|'lost'|'unreachable',reply:string|null,session:string|null,usage:RunUsage|null,toolCalls:ToolCall[],question?:RunQuestion|null,permission?:RunPermission|null};
export type AnsweredQuestion='answered'|'gone'|'unreachable';
export type AnsweredPermission='answered'|'gone'|'unreachable';
export type RunStep={call:string,tool:string,preview:string|null,state:'started'|'done'|'failed'};
export type RunStepEvent={seq:number,step:(Omit<RunStep,'call'>&{call:string|null})|null,endedAt?:number|null};
export type RunEvent=RunStepEvent|{lost:true}|{end:'ended'|'closed'|'gone'|'unreachable'};
export type Agent={name:string,instructions:string,model:string|null,ready:boolean};
export type AgentRequest={name:string,instructions:string,model?:string|null};
export type CreatedAgent={state:'created',agent:Agent}|{state:'exists'|'refused'|'unreachable'|'failed',agent:null};
export type FoundAgent={state:'found',agent:Agent}|{state:'missing'|'refused'|'unreachable',agent:null};
export type AgentLevel=1|2|3;
export type ProvidedAgent={state:'provided'|'noModel'|'forbidden'|'failed'|'refused'|'unreachable'};
export type RemovedAgent={state:'removed'|'missing'|'refused'|'unreachable'};
export type StartUnknown={readonly state:'unknown'};
export function startOutcomeUnknown(result:unknown):result is StartUnknown;
export type Engine={
 start(run:{conversation:string,input:string,idempotencyKey:string,instructions?:string,tools?:ToolSpec[],history?:HistoryEntry[],retry?:boolean}):Promise<string|null|StartUnknown>,
 read(run:string):Promise<RunState>,
 stop(run:string):Promise<boolean>,
 answer(run:string,question:string,text:string):Promise<AnsweredQuestion>,
 permit(run:string,permission:string,choice:PermissionChoice):Promise<AnsweredPermission>,
 steps(run:string,read?:{after?:number,signal?:AbortSignal}):AsyncIterable<RunEvent>,
 length(run:string,read?:{endedAt?:number|null,signal?:AbortSignal}):Promise<number|null>,
 createAgent(agent:AgentRequest):Promise<CreatedAgent>,
 readAgent(name:string):Promise<FoundAgent>,
 provideAgent(agent:{name:string,instructions:string,level:AgentLevel}):Promise<ProvidedAgent>,
 removeAgent(name:string):Promise<RemovedAgent>,
};
export function engineFor(connection:EngineConnection):Engine;
export function outcomeOf(run:Pick<RunState,'state'|'reply'>):'completed'|'failed'|'stopped'|'lost'|null;
