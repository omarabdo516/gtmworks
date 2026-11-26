export const callLimit:number;
export const bodyLimit:number;
export function isHermesAddressAllowed(address:string):boolean;
export type EngineListener='api'|'management';
export type ListenerConnection={address:string,key?:string,managementAddress?:string};
export function bothListeners(connection:ListenerConnection):boolean;
export function onProfile(profile:string,path:string):string;
export type FailureCause='timedOut'|'refused'|'nameNotFound'|'noNetwork'|'failed';
export function failureCause(error:unknown):FailureCause;
export class EngineFailure extends Error {
 constructor(cause:FailureCause|'notAllowed',sent:boolean,error?:unknown);
 cause:FailureCause|'notAllowed';
 sent:boolean;
}
export function withCause<T>(outcome:T,error:unknown):T;
export type ListenerHealth={state:'answering'|'slow'|'down',cause:string|null};
export function listenerHealth(connection:ListenerConnection,listener:EngineListener):ListenerHealth;
export function forgetListeners():void;
export function engineRequest(connection:ListenerConnection,call:{listener?:EngineListener,path:string,method?:string,headers?:Record<string,string>,body?:unknown,deadline?:number,signal?:AbortSignal,stream?:boolean,key?:string|null,now?:boolean}):Promise<Response>;
export function engineSocket(connection:ListenerConnection&{key:string},socket:{path:string,search?:Record<string,string>,binary?:boolean}):WebSocket;
export type HermesConnection={address:string,profile:string,key:string};
export function engineDashboardRequest(connection:ListenerConnection&{key:string},asked:{method:string,path:string,headers:Record<string,string>,body?:Buffer|null}):Promise<import('node:http').IncomingMessage>;
export function engineDashboardSocket(connection:ListenerConnection&{key:string},asked:{path:string,headers:Record<string,string>,guard:{holds:(bytes:Buffer)=>boolean,frames:import('node:stream').Transform}},browser:import('node:stream').Duplex,early:Buffer):Promise<import('node:stream').Duplex|null>;
export const rawStatus:(status:number)=>string;
