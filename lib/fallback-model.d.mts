import type { SupabaseClient } from '@supabase/supabase-js';
type Choice={provider:string,model:string};
export function fallbackPair(value:unknown):Choice|null;
export function chainFor(choice:Choice|null):Choice[];
export function readFallbackModel(db:SupabaseClient,company:string):Promise<string|null|undefined>;
export function changeFallbackModel(db:SupabaseClient,change:{company:string,value:unknown,hermes?:unknown,driver?:Record<string,unknown>,access?:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function keepFallbackModels(db:SupabaseClient,options?:{memory?:Map<string,unknown>,driver?:Record<string,unknown>,engineFor?:(company:string)=>Promise<unknown>,now?:()=>number}):Promise<number>;
