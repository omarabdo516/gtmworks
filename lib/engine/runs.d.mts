import type { HermesConnection } from './transport.mjs';
export const startUnknown:{readonly state:'unknown'};
export function startRun(message:HermesConnection&{input:string,instructions?:string,history?:import('../engine.mjs').HistoryEntry[],sessionKey:string,idempotencyKey:string,retry?:boolean}):Promise<string|null|{readonly state:'unknown'}>;
export type RunUsage={input:number,output:number};
export function readRun(run:HermesConnection&{run:string}):Promise<{status:'running'|'completed'|'failed'|'cancelled'|'interrupted'|'lost'|'unreachable',output:string|null,session:string|null,usage:RunUsage|null,question?:import('../engine.mjs').RunQuestion,noModel?:true,modelRefused?:'credit'|'key'|'model'|'access',resetsAt?:string,served?:import('../engine.mjs').ModelChoice,chosen?:import('../engine.mjs').ModelChoice}>;
export function startSessionRun(start:HermesConnection&{session:string,input:unknown,instructions?:string,idempotencyKey:string,retry?:boolean}):Promise<string|null|{readonly state:'unknown'}|{readonly state:'notReached'}|{readonly state:'keyConflict'}>;
export function readRunEvents(read:HermesConnection&{run:string,signal?:AbortSignal}):AsyncGenerator<import('../engine.mjs').RunEvent>;
