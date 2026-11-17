import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyApp } from './app-catalogue.mjs';
export function readCompanyApps(db:SupabaseClient,service:SupabaseClient,request:{company:string,encryptionKey:string|undefined,driver?:object}):Promise<CompanyApp[]|null>;
export function changeCompanyApp(db:SupabaseClient,service:SupabaseClient,request:{company:string,agent?:unknown,person:string,app:unknown,action:unknown,encryptionKey:string|undefined,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
export function finishCompanyAppSignIn(db:SupabaseClient,service:SupabaseClient,request:{person:string,app:string,answer:Record<string,string>,encryptionKey:string|undefined,driver?:object}):Promise<{slug:string|null,outcome:'connected'|'waiting'|'failed'}>;
