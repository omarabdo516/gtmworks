// The Company's work sandbox (#398): whether the Engine's own ssh workspace, the backend its Agents' terminal, files and
// code run in, answers. One read, no polling.
export type WorkSandboxState={state:'running'|'notRunning'|'refused'|'unreachable'};
export function readWorkSandbox(connection:{address:string,key:string,managementAddress?:string}|null):Promise<WorkSandboxState>;
// The Library of an Agent (#194, #353): one folder of one of the Agent's Library roots in its own Engine profile — its
// work folder, or the images it generated — and one of its files.
export type LibraryEntry={name:string,isFolder:boolean,size:number|null,time:string|null};
export type LibraryList={state:'found',entries:LibraryEntry[]}|{state:'missing'|'refused'|'unreachable'|'invalid',entries:null};
export type LibraryFile={state:'found',name:string,type:string,size:number,body:Uint8Array<ArrayBuffer>}|{state:'missing'|'refused'|'unreachable'|'invalid'|'tooLarge'};
export type LibraryRoot='work'|'images';
export function workSegments(raw:unknown):string[]|null;
export function libraryRoot(raw:unknown):LibraryRoot|null;
export function listAgentFiles(connection:import('../engine.mjs').EngineConnection,folder?:unknown,root?:unknown):Promise<LibraryList>;
export function downloadAgentFile(connection:import('../engine.mjs').EngineConnection,file:{folder?:unknown,name?:unknown,root?:unknown}):Promise<LibraryFile>;
// A file's first part, for the read-only preview (#195): its type, its whole size, whether more follows, and its text
// (null when the Engine read it as binary).
export type LibraryPreview={name:string,type:string,byteSize:number,truncated:boolean,text:string|null};
export type LibraryPreviewRead={state:'found',name:string,type:string,byteSize:number,truncated:boolean,text:string|null}|{state:'missing'|'refused'|'unreachable'|'invalid'|'tooLarge'|'failed'};
export function readAgentFile(connection:import('../engine.mjs').EngineConnection,file:{folder?:unknown,name?:unknown,root?:unknown}):Promise<LibraryPreviewRead>;
