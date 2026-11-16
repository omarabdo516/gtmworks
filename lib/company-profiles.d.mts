import type { SupabaseClient } from '@supabase/supabase-js';
import type { readToolsets } from './hermes.mjs';
export function keepCompanyProfiles(db:SupabaseClient,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,encryptionKey:string|undefined,waiting?:Map<string,number>,now?:()=>number,driver?:object}):Promise<{provided:number,configured:number,attached:number,moved:number}>;
export function moveAgentProfiles(db:SupabaseClient,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,waiting?:Map<string,number>,now?:()=>number,driver:Pick<import('./engine.mjs').Engine,'provideAgent'>}):Promise<{moved:number}>;
export function checkAgentTools(db:SupabaseClient,options:{encryptionKey:string|undefined,read?:typeof readToolsets}):Promise<number>;
export function abandonConversationReservations(db:SupabaseClient):Promise<number>;
