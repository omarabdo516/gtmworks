import type { SupabaseClient } from '@supabase/supabase-js';
export function keepAgentRules(db:SupabaseClient,options?:{memory?:{marks:Map<string,string>,drift:number},health?:ReturnType<typeof import('./engine-health.mjs').engineHealth>,now?:()=>number}):Promise<{written:number}>;
