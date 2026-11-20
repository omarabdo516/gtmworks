import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderKey } from './hermes.mjs';
export type CompanyKeys={keys:ProviderKey[]|null,waiting:{agent:string|null,name:string|null}[]|null,leftover:{agent:string|null,name:string|null}[]|null,unknown:{agent:string|null,name:string|null}[]|null};
export function readCompanyKeys(db:SupabaseClient,service:SupabaseClient,request:{company:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<CompanyKeys>;
export function settleHolds(service:SupabaseClient,company:string,found:{keys:{provider:string,set:boolean}[]}):Promise<{data:unknown}|undefined>;
export function changeCompanyKey(db:SupabaseClient,service:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,value?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
export function companyHasModel(db:SupabaseClient,request:{company:string,hermes?:{address:string,key:string}|null,driver?:object}):Promise<boolean|null>;
export function keyTarget(db:SupabaseClient,service:SupabaseClient|null,company:string,hermes:{address:string,key:string}|null):Promise<{connection:{address:string,profile:string,key:string},space:string,agents:{profile:string,agent:string|null,name:string|null}[],removed:{profile:string,agent:string|null,name:string|null}[]}|null>;
