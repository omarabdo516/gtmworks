import type { SupabaseClient } from '@supabase/supabase-js';
export function keepCompanyProfiles(db:SupabaseClient,options?:{waiting?:Map<string,number>,now?:()=>number}):Promise<{provided:number,configured:number,attached:number,moved:number}>;
export function moveAgentProfiles(db:SupabaseClient,options?:{waiting?:Map<string,number>,now?:()=>number}):Promise<{moved:number}>;
export function checkAgentTools(db:SupabaseClient):Promise<number>;
