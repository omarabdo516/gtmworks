export function readApps(connection:import('../engine.mjs').EngineConnection):Promise<{state:'found',apps:import('../app-catalogue.mjs').CompanyApp[]}|{state:'refused'|'unreachable'|'failed',apps:null}>;
export function prepareApp(connection:import('../engine.mjs').EngineConnection,key:string,redirectUri:string):Promise<null|'refused'|'unreachable'|'failed'>;
export function startAppSignIn(connection:import('../engine.mjs').EngineConnection,key:string,redirectUri:string):Promise<{state:'started',flow:string,url:string}|{state:'busy'|'refused'|'unreachable'|'failed',flow:null,url:null}>;
export function pollAppSignIn(connection:import('../engine.mjs').EngineConnection,flow:string):Promise<{state:'waiting'|'approved'|'expired'|'refused'|'unreachable'|'failed'}>;
export function cancelAppSignIn(connection:import('../engine.mjs').EngineConnection,flow:string):Promise<{state:'cancelled'|'refused'|'unreachable'|'failed'}>;
export function finishAppSignIn(connection:import('../engine.mjs').EngineConnection,signIn:{key:string,flow:string,answer:Record<string,unknown>,settle?:number}):Promise<{state:'approved'|'waiting'|'expired'|'unreachable'|'failed'}>;
export function disconnectApp(connection:import('../engine.mjs').EngineConnection,key:string):Promise<{state:'disconnected'|'refused'|'unreachable'|'failed'}>;
