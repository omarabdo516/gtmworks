import { execFileSync } from 'node:child_process';

// Spec #695: New card asks one of the Company's own Agents, and the seed gives RS Learning none. A spec that makes Cards
// through New card gives it this one first, as a plain Agent every Member sees (not the main one, so a spec may still
// make its own Lead);
// the next file starts from the seed again (tests/fresh-seed.ts).
export const requestAgent = 'a6950000-0000-0000-0000-0000000000a1';
export function ensureRequestAgent() {
 // Supabase CLI targets the local test database by default; never pass --remote.
 execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', `with agent as (insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) values ('${requestAgent}','10000000-0000-0000-0000-000000000001','Requests','General','requests-${requestAgent}',false) on conflict (id) do nothing returning id) insert into public.member_agent_access(company_id,person_id,agent_id) select m.company_id,m.person_id,a.id from public.members m, agent a where m.company_id='10000000-0000-0000-0000-000000000001' and m.removed_at is null on conflict do nothing returning agent_id`, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
}
