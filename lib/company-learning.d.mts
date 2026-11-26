import type { SupabaseClient } from '@supabase/supabase-js';
import type { LearningMode } from './engine-settings.d.mts';
export type LearnedSkill={name:string,description:string};
export type LearningAgent={id:string,name:string,own:boolean,shared:boolean,follow:boolean|null,mode:LearningMode|null,learned:LearnedSkill[]|null};
export type LearningRule={id:string,agent:string,body:string,saidBy:string|null,saidByName:string|null,saidAt:string,removed:boolean,shared:boolean};
export type CompanyLearning={state:'found'|'failed',agents:LearningAgent[]|null,rules:LearningRule[]|null,lessons:LearningRule[]|null};
export function readCompanyLearning(db:SupabaseClient,request:{company:string}):Promise<CompanyLearning>;
export function readStoredLearning(db:SupabaseClient,request:{company:string}):Promise<CompanyLearning>;
