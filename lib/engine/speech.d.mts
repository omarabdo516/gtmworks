export type VoiceChoice={id:string,name:string,label:string};
export type VoiceList={state:'found',available:boolean,voices:VoiceChoice[],error?:string}|{state:'refused'|'unreachable'|'failed',available:false,voices:[]};
export const speakLimit:number;
export function readVoices(connection:import('../engine.mjs').EngineConnection):Promise<VoiceList>;
export function speakText(connection:import('../engine.mjs').EngineConnection,say:{text:string}):Promise<{state:'spoken',dataUrl:string,mimeType:string|null,provider:string|null}|{state:'refused'|'unreachable'|'failed'|'tooLarge',dataUrl:null,mimeType:null,provider:null}>;
export type SpeechRead={provider:string|null,language:string|null,held:string[]};
export function readSpeech(connection:import('../engine.mjs').EngineConnection,asked:{profiles:string[],envs:string[]}):Promise<{state:'found',profiles:Record<string,SpeechRead|null>}|{state:'unreachable'|'failed',profiles:null}>;
export function writeSpeech(connection:import('../engine.mjs').EngineConnection,change:{profile:string,env:string|null,value?:string,config:object|null}):Promise<'written'|'invalid'|'refused'|'unreachable'|'failed'>;
