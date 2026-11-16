import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderKey } from './hermes.mjs';
export type CompanyKeys={keys:ProviderKey[]|null,waiting:{agent:string,name:string|null}[]|null,leftover:{agent:string,name:string|null}[]|null};
export function readCompanyKeys(db:SupabaseClient,service:SupabaseClient,request:{company:string,encryptionKey:string|undefined,driver?:object}):Promise<CompanyKeys>;
export function changeCompanyKey(db:SupabaseClient,service:SupabaseClient,request:{company:string,provider:unknown,intent:unknown,value?:unknown,encryptionKey:string|undefined,driver?:object}):Promise<{status:number,body:Record<string,unknown>}>;
