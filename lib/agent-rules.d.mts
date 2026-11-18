import type { SupabaseClient } from '@supabase/supabase-js';
import type { writeSoulRules } from './hermes.mjs';
export function keepAgentRules(db:SupabaseClient,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,write?:typeof writeSoulRules}):Promise<{written:number}>;
