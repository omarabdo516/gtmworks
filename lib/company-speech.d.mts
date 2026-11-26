import type { SupabaseClient } from '@supabase/supabase-js';
export type SpeechProvider='deepgram'|'elevenlabs'|'openai'|'groq';
export const deepgramArabic:readonly string[];
export const deepgramCommand:string;
export type CompanySpeech={provider:SpeechProvider|null,missing:{agent:string|null,name:string|null}[]|null};
export function readCompanySpeech(db:SupabaseClient,request:{company:string}):Promise<CompanySpeech>;
export function changeCompanySpeech(db:SupabaseClient,request:{company:string,provider?:unknown,intent:unknown,value?:unknown}):Promise<{status:number,body:(CompanySpeech&{failed:{agent:string|null,name:string|null}[]})|{error:string}}>;
