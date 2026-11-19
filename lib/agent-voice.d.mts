import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceList } from './hermes.mjs';
export const voiceLanguages:readonly string[];
export const voiceSpeeds:readonly number[];
export function voiceSample(language:string,name:unknown):string;
export type AgentVoice={state:'found',own:boolean,language:string,speed:number,provider:string,voice:string|null,voiceName:string|null,list:VoiceList|null}
 |{state:'refused'|'unreachable'|'failed',own:boolean,language:string,speed:number,provider:string,voice:null,voiceName:null,list:null};
export type VoiceValues={language:string,speed:number,voice:string|null};
export type VoiceRefusal='invalid'|'notOwn'|'notAllowed'|'noEngine'|'noVoices'|'refused'|'unreachable'|'failed'|'mismatch';
export function readAgentVoice(db:SupabaseClient,request:{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<AgentVoice|null>;
export function changeAgentVoice(db:SupabaseClient,request:{company:string,agent:unknown,voice:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{state:'written',voice:VoiceValues}|{state:VoiceRefusal,voice:null}>;
export function speakAgentSample(db:SupabaseClient,request:{company:string,agent:unknown,text:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{state:'spoken',dataUrl:string,mimeType:string|null,provider:string|null}|{state:'invalid'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed'|'tooLarge',dataUrl:null,mimeType:null,provider:null}>;
