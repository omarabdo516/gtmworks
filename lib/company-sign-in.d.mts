import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignInProvider } from './hermes.mjs';
// What a Company's subscription is, by kind of install (ADR 0016, Sign-in): on one Company a root sign-in is
// `connected` and an older one in the Company profile `mainAgentOnly`, and one left only in an Agent's own profile `someAgentsOnly`; on several a root sign-in is `shared`.
export type SubscriptionState='connected'|'mainAgentOnly'|'someAgentsOnly'|'shared'|'notConnected';
export type CompanySignIns={profile:string|null,oneCompany:boolean,signIns:Record<SignInProvider,{state:SubscriptionState,flow:'device_code'|'external'}>|null,noEngine?:boolean};
export function readCompanySignIns(db:SupabaseClient,request:{company:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<CompanySignIns>;
export function changeCompanySignIn(db:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,session?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
export function signInTarget(db:SupabaseClient,company:string,hermes?:{address:string,key:string}|null):Promise<{address:string,profile:string,key:string,oneCompany:boolean,profiles:string[]}|null>;
