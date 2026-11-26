import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderKey } from './engine/providers.mjs';
export type CompanyKeys={keys:ProviderKey[]|null,waiting:{agent:string|null,name:string|null}[]|null,leftover:{agent:string|null,name:string|null}[]|null,unknown:{agent:string|null,name:string|null}[]|null};
export function readCompanyKeys(db:SupabaseClient,service:SupabaseClient,request:{company:string}):Promise<CompanyKeys>;
export function settleHolds(service:SupabaseClient,company:string,found:{keys:{provider:string,set:boolean}[]}):Promise<{data:unknown}|undefined>;
export function changeCompanyKey(db:SupabaseClient,service:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,value?:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
export function companyHasModel(db:SupabaseClient,request:{company:string}):Promise<boolean|null>;
export function keyTarget(db:SupabaseClient,service:SupabaseClient|null,company:string):Promise<{engine:NonNullable<Awaited<ReturnType<typeof import('./engine/handle.mjs').companyEngine>>>,at:NonNullable<ReturnType<NonNullable<Awaited<ReturnType<typeof import('./engine/handle.mjs').companyEngine>>>['on']>>,keys:NonNullable<ReturnType<NonNullable<Awaited<ReturnType<typeof import('./engine/handle.mjs').companyEngine>>>['on']>>['providers'],space:string,agents:{profile:string,agent:string|null,name:string|null}[],removed:{profile:string,agent:string|null,name:string|null}[]}|null>;
