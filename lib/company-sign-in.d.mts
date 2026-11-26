import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignInProvider } from './engine/providers.mjs';
// What a Company's subscription is (#384, ADR 0018): a sign-in on the root profile of the Company's own Engine is
// `connected`; one an earlier version left on the Company's profile is `mainAgentOnly`, and one left on an Agent's own
// profile is `someAgentsOnly`. `noEngine` is the one plain state of a Company whose Engine is not made or not answering.
export type SubscriptionState='connected'|'mainAgentOnly'|'someAgentsOnly'|'notConnected';
// One subscription account of the root's (#618): the Engine's id for it, never a credential or the Engine's label.
export type SubscriptionAccount={provider:SignInProvider,account:string,exhausted:boolean};
export type CompanySignIns={profile:string|null,profiles:string[]|null,signIns:Record<SignInProvider,{state:SubscriptionState,flow:'device_code'|'external'}>|null,accounts?:SubscriptionAccount[]|null,noEngine?:boolean,unread?:boolean};
export function readCompanySignIns(db:SupabaseClient,request:{company:string}):Promise<CompanySignIns>;
export function changeCompanySignIn(db:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,session?:unknown,account?:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function signInTarget(db:SupabaseClient,company:string):ReturnType<typeof import('./engine/handle.mjs').companyEngine>;
