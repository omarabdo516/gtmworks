import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignInProvider } from './hermes.mjs';
// What a Company's subscription is (#384, ADR 0018): a sign-in on the root profile of the Company's own Engine is
// `connected`; one an earlier version left on the Company's profile is `mainAgentOnly`, and one left on an Agent's own
// profile is `someAgentsOnly`.
export type SubscriptionState='connected'|'mainAgentOnly'|'someAgentsOnly'|'notConnected';
export type CompanySignIns={profile:string|null,profiles:string[]|null,signIns:Record<SignInProvider,{state:SubscriptionState,flow:'device_code'|'external'}>|null};
export function readCompanySignIns(db:SupabaseClient,request:{company:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<CompanySignIns>;
export function changeCompanySignIn(db:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,session?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
export function signInTarget(db:SupabaseClient,company:string,hermes?:{address:string,key:string}|null):Promise<{address:string,key:string,profile:string|null,profiles:string[]}|null>;
