import type { SupabaseClient } from '@supabase/supabase-js';
import type { readToolsets } from './hermes.mjs';
export const companySoul:string;
export function keepCompanyProfiles(db:SupabaseClient,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,encryptionKey:string|undefined,waiting?:Map<string,number>,now?:()=>number,driver?:object}):Promise<{provided:number,configured:number,attached:number,moved:number}>;
export function checkAgentTools(db:SupabaseClient,options:{encryptionKey:string|undefined,read?:typeof readToolsets}):Promise<number>;
export function abandonConversationReservations(db:SupabaseClient):Promise<number>;
