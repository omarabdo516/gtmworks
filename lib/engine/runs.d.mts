import type { HermesConnection } from './transport.mjs';
export const startUnknown:{readonly state:'unknown'};
// What a start answers (#413, #708, #876, #877): a run id, a refusal, or a state of its own.
export type StartAnswer=string|null|{readonly state:'unknown'}|{readonly state:'notReached'}|{readonly state:'keyConflict'}|{readonly state:'queueFull'}|{readonly state:'busy',readonly retryAfter:number};
export function startRun(message:HermesConnection&{input:string,instructions?:string,history?:import('../engine.mjs').HistoryEntry[],sessionKey:string,idempotencyKey:string,retry?:boolean}):Promise<StartAnswer>;
export type RunUsage={input:number,output:number};
export function readRun(run:HermesConnection&{run:string}):Promise<{status:'running'|'completed'|'failed'|'cancelled'|'interrupted'|'lost'|'unreachable',queued?:true,output:string|null,session:string|null,usage:RunUsage|null,question?:import('../engine.mjs').RunQuestion,noModel?:true,modelRefused?:'credit'|'key'|'model'|'access',resetsAt?:string,served?:import('../engine.mjs').ModelChoice,chosen?:import('../engine.mjs').ModelChoice}>;
export function startSessionRun(start:HermesConnection&{session:string,input:unknown,instructions?:string,idempotencyKey:string,retry?:boolean}):Promise<StartAnswer>;
export function readRunEvents(read:HermesConnection&{run:string,signal?:AbortSignal}):AsyncGenerator<import('../engine.mjs').RunEvent>;
