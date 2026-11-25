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
// `allows` is what an "always" answer keeps among the profile's standing permissions (#166), none when it is not offered.
export type RunPermission={id:string,description:string,command:string,choices:PermissionChoice[],allows?:string[]};
// `said`: what the Agent wrote in the message that paused the Run on its question or permission (#647), as its words.
export type RunState={state:'running'|'completed'|'failed'|'stopped'|'lost'|'unreachable',reply:string|null,session:string|null,usage:RunUsage|null,toolCalls:ToolCall[],question?:RunQuestion|null,permission?:RunPermission|null,said?:string,noModel?:true,modelRefused?:'credit'|'key'|'model'|'access',resetsAt?:string,served?:ModelChoice,chosen?:ModelChoice};
// Typed words, or the texts of the choices picked on a question where several may be picked (#648).
export type QuestionAnswer=string|string[];
export type AnsweredQuestion='answered'|'gone'|'unreachable';
export type AnsweredPermission='answered'|'gone'|'unreachable';
// `routine`: the Routine a create through the Engine's scheduling tool made (#205), its name and schedule as the Engine shows them.
export type RunStep={tool:string,preview:string|null,state:'started'|'done'|'failed',sandbox?:true,routine?:{name:string,schedule:string}};
export type SessionTurn={at:number,seconds:number,steps:RunStep[]};
export type SessionUsage={input:number,output:number};
export type SessionRead={state:'found',turns:SessionTurn[],usage:SessionUsage|null}|{state:'missing'|'refused'|'unreachable',turns:null,usage:null};
// A Run's tool calls as they happen (#646): each call starting (its id, tool and the Engine's preview) or ending (done or
// failed, by the same id, or none when the Engine gave it none), a loss when older events are gone, and one end last.
export type RunStepEvent={seq:number,step:{call:string|null,tool:string,preview:string|null,state:'started'|'done'|'failed'}};
export type RunEvent=RunStepEvent|{lost:true}|{end:'ended'|'closed'|'gone'|'unreachable'};
export type Agent={name:string,instructions:string,model:string|null,ready:boolean,displayName?:string|null,description?:string,descriptionAuto?:boolean,botTitle?:string|null};
export type AgentRequest={name:string,instructions:string,model?:string|null};
export type CreatedAgent={state:'created',agent:Agent}|{state:'exists'|'refused'|'unreachable'|'failed',agent:null};
export type FoundAgent={state:'found',agent:Agent}|{state:'missing'|'refused'|'unreachable',agent:null};
// A model a Run may be started on (#158): the Engine's provider and model names.
export type ModelChoice={provider:string,model:string};
export type AgentModels={state:'found'|'refused'|'unreachable',current:ModelChoice|null,models:(ModelChoice&{providerName:string,served?:true})[]};
// Where an Agent's own profile takes the Company's Providers from (#660): its shared space, whose API keys it is given, and
// the profile of the Company's keeper (Lead), whose model it starts on.
export type CompanyProviders={space:string,keeper:string};
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
export type MemoryReset={state:'reset'|'refused'|'unreachable'|'failed',unsent?:true};
// One note rewritten or removed by the Engine's own id (#191); a note that changed since it was read is `stale`.
export type MemoryEdit={state:'edited'|'stale'|'refused'|'unreachable'|'failed',unsent?:true};
export type MemoryForget={state:'forgotten'|'stale'|'refused'|'unreachable'|'failed',unsent?:true};
// An Agent's standing permissions (#166): its own profile's entries, each as the Engine keeps it; revoking one is
// revoked (read back without it), gone (it was not there), or why it could not be done.
export type StandingPermissions={state:'found',entries:string[]}|{state:'refused'|'unreachable'|'failed',entries:null};
// `removed`, once the write was sent: whether a read-back still showed the entry ('no'), no longer did ('yes'), or could
// not tell ('maybe'); absent when nothing was written. `unconfirmed`: the Engine never confirmed the write, so it may
// still land later, whatever the read-back showed.
export type StandingRevoke={state:'revoked'|'gone'|'refused'|'unreachable'|'failed',removed?:'no'|'maybe'|'yes',unconfirmed?:true};
// An Agent's Routine (#31): one cron job of its own Engine profile, as the contract reads it.
export type RoutineSchedule={kind:string,expr:string|null,minutes:number|null,display:string|null};
export type Routine={id:string,name:string,prompt:string,schedule:RoutineSchedule,timezone:string|null,on:boolean,state:'scheduled'|'paused'|'running'|'completed'|'error',nextRunAt:string|null,lastRunAt:string|null,lastStatus:'ok'|'failed'|null,lastError:string|null};
export type RoutineList={state:'found',routines:Routine[]}|{state:'refused'|'unreachable'|'failed',routines:null};
export type RoutineChange={state:'done',routine:Routine}|{state:'missing'|'refused'|'busy'|'unreachable'|'failed'};
// How marking a conversation's session archived, or not, ended (#674).
export type SessionMark='marked'|'missing'|'refused'|'unreachable';
export type StartUnknown={readonly state:'unknown'};
export function startOutcomeUnknown(result:unknown):result is StartUnknown;
export type Engine={
 start(run:{conversation:string,input:RunInput,idempotencyKey:string,instructions?:string,tools?:ToolSpec[],history?:HistoryEntry[],model?:ModelChoice,retry?:boolean}):Promise<string|null|StartUnknown>,
 transcribe(audio:{dataUrl:string,mimeType:string}):Promise<Transcription>,
 dictation?():Promise<DictationSettings>,
 read(run:string):Promise<RunState>,
 stop(run:string):Promise<boolean>,
 answer(run:string,question:string,text:QuestionAnswer):Promise<AnsweredQuestion>,
 permit(run:string,permission:string,choice:PermissionChoice):Promise<AnsweredPermission>,
 session(session:string):Promise<SessionRead>,
 markSession?(session:string,archived:boolean):Promise<SessionMark>,
 steps?(run:string,read?:{signal?:AbortSignal}):AsyncIterable<RunEvent>,
 createAgent(agent:AgentRequest):Promise<CreatedAgent>,
 readAgent(name:string):Promise<FoundAgent>,
 provideAgent(agent:{name:string,instructions:string,subagents?:boolean,providers?:CompanyProviders}):Promise<ProvidedAgent>,
 giveProviders?(target:{name:string}&CompanyProviders):Promise<ProvidedAgent>,
 removeAgent(name:string):Promise<RemovedAgent>,
 readKeys?(space:string):Promise<ProviderKeys>,
 models?():Promise<AgentModels>,
 apps?():Promise<ProfileApps>,
 screen?():Promise<ScreenRead>,
 wakeScreen?():Promise<ScreenWake>,
 screenPicture?():Promise<ScreenPicture>,
};
// An Agent's Screen (#712): its state, who controls it and why a start would be refused; a start; one picture.
export type ScreenState={state:'none'|'asleep'|'awake',control:'agent'|'person',refusal:null|'missing'};
export type ScreenRead={state:'found',screen:ScreenState}|{state:'missing'|'unreachable'};
export type ScreenWake={state:'awake',screen:ScreenState}|{state:'notStarted',reason:'missing'|'failed'}|{state:'missing'|'unreachable'};
// A viewer of an Agent's Screen (#713): who controls it as this viewer sees it, a take refused while another viewer
// holds, a give-back (by force for control nobody holds any more), a live RFB stream on a fresh ticket, and close, which
// gives back what it holds.
export type ScreenControl='agent'|'mine'|'other'|'gone';
export type ScreenViewer={
 control():Promise<ScreenControl>,
 take():Promise<{state:'taken'|'held'|'failed'}>,
 giveBack(options?:{force?:boolean}):Promise<{state:'given'|'failed'}>,
 stream():Promise<WebSocket|null>,
 close():Promise<void>,
};
export type ScreenViewerOpen={state:'open',viewer:ScreenViewer}|{state:'asleep'|'missing'|'unreachable'};
export type ScreenPicture={state:'found',type:string,body:Uint8Array}|{state:'asleep'|'withheld'|'failed'|'missing'|'unreachable'};
export function engineFor(connection:EngineConnection):Engine;
export type RunEnd='completed'|'failed'|'no_model'|'no_credit'|'key_refused'|'model_missing'|'stopped'|'lost';
export function endOf(run:Pick<RunState,'state'|'reply'|'noModel'|'modelRefused'>):RunEnd|null;
