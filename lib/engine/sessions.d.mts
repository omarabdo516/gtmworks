export function readSession(connection:import('../engine.mjs').EngineConnection,session:string):Promise<import('../engine.mjs').SessionRead>;
export function readSessionMessages(connection:import('../engine.mjs').EngineConnection,session:string,page?:{offset?:number,limit?:number}):Promise<import('../engine.mjs').SessionMessagesRead>;
export function readSessionUsage(connection:import('../engine.mjs').EngineConnection,session:string):Promise<import('../engine.mjs').SessionUsage|null>;
export function stepsBetween(messages:import('../engine.mjs').SessionMessage[],from:number,to:number):{list:import('../engine.mjs').RunStep[],seconds:number}|null;
export type UsageModel={model:string,input:number,output:number,sessions:number};
export type ProfileUsage={state:'found',input:number,output:number,sessions:number,models:UsageModel[]}|{state:'refused'|'unreachable',input:null,output:null,sessions:null,models:null};
export function readUsage(connection:import('../engine.mjs').EngineConnection,days:number):Promise<ProfileUsage>;
export function isSilentReply(reply:unknown):boolean;
