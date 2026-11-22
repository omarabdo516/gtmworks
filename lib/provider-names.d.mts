import type { SupabaseClient } from '@supabase/supabase-js';
export const keyAccount:'key';
export const nameLimit:number;
export function nameKey(provider:string,account:string):string;
export function readProviderNames(db:SupabaseClient,company:string):Promise<Record<string,string>>;
export function renameProvider(db:SupabaseClient,change:{company:string,provider:unknown,account:unknown,name:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function forgetProviderName(db:SupabaseClient,gone:{company:string,provider:string,account:string}):Promise<void>;
