import type { RunUsage } from './hermes.mjs';
export type EngineConnection={address:string,profile:string,key:string,managementAddress?:string};
export type JsonSchemaObject={type:'object',properties:Record<string,unknown>,required?:string[],additionalProperties?:boolean};
export type ToolSpec={name:string,description:string,parameters:JsonSchemaObject};
export type ToolCall={id:string,name:string,arguments:unknown};
export type HistoryEntry={role:'user'|'assistant',content:string};
// What a Run is given to read (#155): a message's text, or, when it carries images, messages whose last one holds the
// text and then one image part per file, as the pinned Engine's `/v1/runs` reads them. A file or document part is
// refused by the Engine, so gtmworks sends none.
export type RunInputPart={type:'text',text:string}|{type:'image_url',image_url:{url:string}};
export type RunInputMessage={role:'user',content:RunInputPart[]};
export type RunInput=string|RunInputMessage[];
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
export type Agent={name:string,instructions:string,model:string|null,ready:boolean,displayName?:string|null,description?:string,descriptionAuto?:boolean,botTitle?:string|null};
export type AgentRequest={name:string,instructions:string,model?:string|null};
export type CreatedAgent={state:'created',agent:Agent}|{state:'exists'|'refused'|'unreachable'|'failed',agent:null};
export type FoundAgent={state:'found',agent:Agent}|{state:'missing'|'refused'|'unreachable',agent:null};
// A model a Run may be started on (#158): the Engine's provider and model names.
export type ModelChoice={provider:string,model:string};
export type AgentModels={state:'found'|'refused'|'unreachable',current:ModelChoice|null,models:(ModelChoice&{providerName:string})[]};
export type ProvidedAgent={state:'provided'|'noModel'|'forbidden'|'failed'|'refused'|'unreachable'};
export type RemovedAgent={state:'removed'|'missing'|'refused'|'unreachable'};
// The apps of the profile an Engine is bound to (#203): each listed app the Engine offers it, with its state there.
export type ProfileApps={state:'found',apps:{key:string,state:import('./app-catalogue.mjs').AppState}[]}|{state:'refused'|'unreachable'|'failed',apps:null};
// One recording as text (#160): the transcript, or why there is none. `unavailable` is the engine saying it has no
// speech-to-text provider to use; an empty transcript is silence, not an error.
export type Transcription={state:'transcribed',text:string}|{state:'unavailable'|'refused'|'unreachable'|'failed'};
// The language an Agent's profile listens in (`stt.language`); null when the profile detects it itself.
export type DictationSettings={state:'found',language:string|null}|{state:'refused'|'unreachable'|'failed',language:null};
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
 start(run:{conversation:string,input:RunInput,idempotencyKey:string,instructions?:string,tools?:ToolSpec[],history?:HistoryEntry[],model?:ModelChoice,retry?:boolean}):Promise<string|null|StartUnknown>,
 transcribe(audio:{dataUrl:string,mimeType:string}):Promise<Transcription>,
 dictation?():Promise<DictationSettings>,
 read(run:string):Promise<RunState>,
 stop(run:string):Promise<boolean>,
 answer(run:string,question:string,text:string):Promise<AnsweredQuestion>,
 permit(run:string,permission:string,choice:PermissionChoice):Promise<AnsweredPermission>,
 session(session:string):Promise<SessionRead>,
 createAgent(agent:AgentRequest):Promise<CreatedAgent>,
 readAgent(name:string):Promise<FoundAgent>,
 provideAgent(agent:{name:string,instructions:string}):Promise<ProvidedAgent>,
 removeAgent(name:string):Promise<RemovedAgent>,
 readKeys?(space:string):Promise<ProviderKeys>,
 models?():Promise<AgentModels>,
 apps?():Promise<ProfileApps>,
};
export function engineFor(connection:EngineConnection):Engine;
export function outcomeOf(run:Pick<RunState,'state'|'reply'>):'completed'|'failed'|'stopped'|'lost'|null;
