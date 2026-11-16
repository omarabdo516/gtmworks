import type { SupabaseClient } from '@supabase/supabase-js';
import type { provideSharedSpace, writeSharedSkill, shareSkills } from './hermes.mjs';
export function teamLessons(lessons:string[]):string;
export function keepSharedSkills(db:SupabaseClient,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,driver?:{provide:typeof provideSharedSpace,write:typeof writeSharedSkill,share:typeof shareSkills}}):Promise<{made:number,written:number,shared:number}>;
