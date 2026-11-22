import type { SupabaseClient } from '@supabase/supabase-js';
export type Placed={place:number|null,enabled:boolean};
export function readProviderOrder(db:SupabaseClient,company:string):Promise<Record<string,Placed>|null>;
export function inOrder<T extends {provider:string,account:string|null}>(entries:T[],order:Record<string,Placed>):T[];
export function providerOn(order:Record<string,Placed>,entry:{provider:string,account:string|null}):boolean;
export function orderProviders(db:SupabaseClient,change:{company:string,entries:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function switchProvider(db:SupabaseClient,change:{company:string,provider:unknown,account:unknown,enabled:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function forgetProviderOrder(db:SupabaseClient,gone:{company:string,provider:string,account:string}):Promise<boolean>;
