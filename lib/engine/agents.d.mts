import type { HermesConnection } from './transport.mjs';
export type ProfileTools={state:'configured'|'missing'|'refused'|'unreachable'|'failed',toolsets:string[]|null};
export function provideProfile(connection:import('../engine.mjs').EngineConnection,profile:{name:string,soul:string,config:object,forbidden:string[]}):Promise<ProfileTools>;
export function configureProfile(connection:import('../engine.mjs').EngineConnection,profile:{name:string,config:object,forbidden:string[]}):Promise<ProfileTools>;
export function readToolsets(connection:HermesConnection):Promise<{state:'found'|'missing'|'refused'|'unreachable'|'failed',toolsets:string[]|null}>;
export function readAgent(connection:import('../engine.mjs').EngineConnection,name:string):Promise<(import('../engine.mjs').FoundAgent)>;
export function writeAgentAbout(connection:HermesConnection,change:{name:string,description:string}):Promise<{state:'written',description:string}|{state:'refused'|'unreachable'|'failed',description:null}>;
