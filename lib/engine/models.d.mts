import type { HermesConnection } from './transport.mjs';
export function readModels(connection:import('../engine.mjs').EngineConnection):Promise<import('../engine.mjs').AgentModels>;
export type ProfileModels={state:'found',models:Record<string,{provider:string,model:string}|null>}|{state:'refused'|'unreachable'|'failed',models:null};
export function readProfileModels(connection:HermesConnection,profiles:string[]):Promise<ProfileModels>;
export function writeProfileModel(connection:HermesConnection,change:{profile:string,provider:string,model:string}):Promise<{state:'saved',provider:string,model:string}|{state:'mismatch'|'refused'|'unreachable'|'failed',provider:null,model:null}>;
export function readFallbackChain(connection:import('../engine.mjs').EngineConnection):Promise<{state:'found',chain:{provider:string,model:string}[],legacy:boolean}|{state:'refused'|'unreachable'|'failed',chain:null,legacy:false}>;
export function writeFallbackChain(connection:import('../engine.mjs').EngineConnection,change:{chain:{provider:string,model:string}[],legacy?:boolean}):Promise<{state:'saved'|'mismatch'|'written'|'refused'|'unreachable'|'failed'}>;
export function sameChain(one:{provider:string,model:string}[],other:{provider:string,model:string}[]):boolean;
