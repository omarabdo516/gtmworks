import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// An install updated to #696 (ADR 0027) gives every Agent it already has a look, in the migration's last block, replayed
// here on Agents made with the trigger off, as the release before it made them. Each Company's main Agent is indigo and
// calm though it was made last; an Agent from a ready-made role has that role's temperament; every other Agent takes the
// colour and the temperament its Company uses least, so no colour comes twice while there are eight or fewer; and an
// Agent that already has a look keeps it. The database this runs on has the migration.
const migration=readFileSync('supabase/migrations/20270416000001_agent_looks.sql','utf8');
const backfill=migration.match(/^do \$\$ declare a record; begin\n[\s\S]*?\nend \$\$;$/m)?.[0];
if(!backfill) throw new Error('the migration has no block that gives every Agent its look');
const company='10000000-0000-0000-0000-000000000002';
const agent=n=>`'d6970000-0000-0000-0000-0000000000${String(n).padStart(2,'0')}'`;
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
alter table public.hermes_agents disable trigger agent_look_given;
-- R&S Consultations (2): nine Agents made in turn before its Lead, the second from the ready-made writer role.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,template,created_at)
 select ${agent(1)}::uuid,'${company}'::uuid,gen_random_uuid(),'Lead','General',true,'co-10000000000000000000000000000002',null,now()
 union all
 select ('d6970000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'${company}',gen_random_uuid(),'Agent '||n,'Helps',false,'co-10000000000000000000000000000002',
  case when n=3 then 'writer' end,now()-interval '1 day'+n*interval '1 minute' from generate_series(2,10) n;
-- Aleem's Lead already has its look, an Owner's pick on it.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 (${agent(99)},'10000000-0000-0000-0000-000000000003',gen_random_uuid(),'Lead','General',true,'co-10000000000000000000000000000003');
insert into public.agent_looks(agent_id,company_id,auto_shape,auto_colour,auto_temperament,picked_colour) values (${agent(99)},'10000000-0000-0000-0000-000000000003','circle','indigo','calm','rose');
alter table public.hermes_agents enable trigger agent_look_given;
select is((select count(*)::int from public.agent_looks where company_id='${company}'),0,'the Agents made before the update have no look');
${backfill}
select is((select shape||' '||colour||' '||temperament from public.agent_looks where agent_id=${agent(1)}),'circle indigo calm','the main Agent is indigo and calm, though it was made last');
select results_eq($$select a.name,l.colour,l.temperament from public.agent_looks l join public.hermes_agents a on a.id=l.agent_id
  where l.company_id='${company}' and not a.is_default order by a.created_at$$,
 $$values ('Agent 2'::text,'violet'::text,'energetic'::text),('Agent 3','sky','dreamy'),('Agent 4','teal','warm'),('Agent 5','jade','neat'),('Agent 6','rose','caring'),
  ('Agent 7','dusk','calm'),('Agent 8','slate','energetic'),('Agent 9','violet','warm'),('Agent 10','sky','dreamy')$$,
 'the others, as they were made: the writer dreamy, the rest the least used temperament, and each a colour of its own until all eight are taken, indigo never again');
select is((select count(distinct colour)::int from public.agent_looks l join public.hermes_agents a on a.id=l.agent_id where l.company_id='${company}' and a.name not in ('Agent 9','Agent 10')),8,
 'eight Agents, eight colours');
select is((select colour from public.agent_looks where agent_id=${agent(99)}),'rose','an Agent that already had a look keeps it');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
