import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignInProvider } from './hermes.mjs';
// What a Company's subscription is, by kind of install (ADR 0016, Sign-in): on one Company a root sign-in is
// `connected` and an older one in the Company profile `mainAgentOnly`; on several a root sign-in is `shared`.
export type SubscriptionState='connected'|'mainAgentOnly'|'shared'|'notConnected';
export type CompanySignIns={profile:string|null,oneCompany:boolean,signIns:Record<SignInProvider,{state:SubscriptionState,flow:'device_code'|'external'}>|null};
export function readCompanySignIns(db:SupabaseClient,service:SupabaseClient,request:{company:string,encryptionKey:string|undefined,driver?:object}):Promise<CompanySignIns>;
export function changeCompanySignIn(db:SupabaseClient,service:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,session?:unknown,encryptionKey:string|undefined,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
export function signInTarget(db:SupabaseClient,service:SupabaseClient,company:string,encryptionKey:string|undefined):Promise<{address:string,profile:string,key:string,oneCompany:boolean,profiles:string[]}|null>;
