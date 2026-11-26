import type { SupabaseClient } from '@supabase/supabase-js';
import type { LearningMode } from './engine-settings.d.mts';
export type CompanySkillPage = {
  state: 'found' | 'absent' | 'refused' | 'unreachable' | 'failed',
  agent: { id: string, name: string, own: boolean },
  skill: string,
  mode: LearningMode | null,
  content: string | null,
};
export function readCompanySkillPage(db: SupabaseClient, request: {
  company: string,
  agent: string,
  name: string,
  person: string,
}): Promise<CompanySkillPage | null>;
