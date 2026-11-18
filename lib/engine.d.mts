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
export type RunStep={tool:string,preview:string|null,state:'started'|'done'|'failed'};
export type SessionTurn={at:number,seconds:number,steps:RunStep[]};
export type SessionUsage={input:number,output:number};
export type SessionRead={state:'found',turns:SessionTurn[],usage:SessionUsage|null}|{state:'missing'|'refused'|'unreachable',turns:null,usage:null};
export type Agent={name:string,instructions:string,model:string|null,ready:boolean};
export type AgentRequest={name:string,instructions:string,model?:string|null};
export type CreatedAgent={state:'created',agent:Agent}|{state:'exists'|'refused'|'unreachable'|'failed',agent:null};
export type FoundAgent={state:'found',agent:Agent}|{state:'missing'|'refused'|'unreachable',agent:null};
export type AgentLevel=1|2|3;
// A model a Run may be started on (#158): the Engine's provider and model names.
export type ModelChoice={provider:string,model:string};
export type AgentModels={state:'found'|'refused'|'unreachable',current:ModelChoice|null,models:(ModelChoice&{providerName:string})[]};
export type ProvidedAgent={state:'provided'|'noModel'|'forbidden'|'failed'|'refused'|'unreachable'};
export type RemovedAgent={state:'removed'|'missing'|'refused'|'unreachable'};
// The apps of the profile an Engine is bound to (#203): each listed app the Engine offers it, with its state there.
export type ProfileApps={state:'found',apps:{key:string,state:import('./app-catalogue.mjs').AppState}[]}|{state:'refused'|'unreachable'|'failed',apps:null};
export type ProviderKeys={state:'found',keys:import('./hermes.mjs').ProviderKey[]}|{state:'refused'|'unreachable'|'failed',keys:null};
// An Agent's memory (#350), read from its own profile: its notes, each with the Engine's id and its text, never a skill.
export type MemoryNote={id:string,text:string};
export type MemoryNotes={state:'found',notes:MemoryNote[]}|{state:'refused'|'unreachable'|'failed',notes:null};
export type MemoryReset={state:'reset'|'refused'|'unreachable'|'failed'};
// One note rewritten or removed by the Engine's own id (#191); a note that changed since it was read is `stale`.
export type MemoryEdit={state:'edited'|'stale'|'refused'|'unreachable'|'failed'};
export type MemoryForget={state:'forgotten'|'stale'|'refused'|'unreachable'|'failed'};
export type StartUnknown={readonly state:'unknown'};
export function startOutcomeUnknown(result:unknown):result is StartUnknown;
export type Engine={
 start(run:{conversation:string,input:string,idempotencyKey:string,instructions?:string,tools?:ToolSpec[],history?:HistoryEntry[],model?:ModelChoice,retry?:boolean}):Promise<string|null|StartUnknown>,
 read(run:string):Promise<RunState>,
 stop(run:string):Promise<boolean>,
 answer(run:string,question:string,text:string):Promise<AnsweredQuestion>,
 permit(run:string,permission:string,choice:PermissionChoice):Promise<AnsweredPermission>,
 session(session:string):Promise<SessionRead>,
 createAgent(agent:AgentRequest):Promise<CreatedAgent>,
 readAgent(name:string):Promise<FoundAgent>,
 provideAgent(agent:{name:string,instructions:string,level:AgentLevel}):Promise<ProvidedAgent>,
 removeAgent(name:string):Promise<RemovedAgent>,
 readKeys?(space:string):Promise<ProviderKeys>,
 models?():Promise<AgentModels>,
 apps?():Promise<ProfileApps>,
};
export function engineFor(connection:EngineConnection):Engine;
export function outcomeOf(run:Pick<RunState,'state'|'reply'>):'completed'|'failed'|'stopped'|'lost'|null;
