export function readSession(connection:import('../engine.mjs').EngineConnection,session:string):Promise<import('../engine.mjs').SessionRead>;
export type UsageModel={model:string,input:number,output:number,sessions:number};
export type ProfileUsage={state:'found',input:number,output:number,sessions:number,models:UsageModel[]}|{state:'refused'|'unreachable',input:null,output:null,sessions:null,models:null};
export function readUsage(connection:import('../engine.mjs').EngineConnection,days:number):Promise<ProfileUsage>;
export function isSilentReply(reply:unknown):boolean;
