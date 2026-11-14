import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignIns } from './hermes.mjs';
export function signInTarget(db:SupabaseClient,service:SupabaseClient,company:string,encryptionKey:string|undefined):Promise<{address:string,profile:string,key:string}|null>;
export function readCompanySignIns(db:SupabaseClient,service:SupabaseClient,request:{company:string,encryptionKey:string|undefined,driver?:object}):Promise<{profile:string|null,signIns:SignIns|null}>;
export function changeCompanySignIn(db:SupabaseClient,service:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,session?:unknown,encryptionKey:string|undefined,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
