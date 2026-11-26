import type { SupabaseClient } from '@supabase/supabase-js';
export function teamLessons(lessons:string[]):string;
export function keepSharedSkills(db:SupabaseClient,options?:{memory?:{marks:Map<string,string>,drift:number},health?:ReturnType<typeof import('./engine-health.mjs').engineHealth>,now?:()=>number}):Promise<{made:number,written:number,shared:number}>;
