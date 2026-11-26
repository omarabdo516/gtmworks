import { readFileSync } from 'node:fs';
import { roleAgentsAsTheyStood, testDb } from './pgtap.mjs';

// Spec #695 (#703, #704, ADR 0023): the two steps that remove the four legacy role agents, replayed on the install shapes
// the spec names. The local database has already applied both, so the replay first puts back what the role agents had
// (the key on a membership and its type, the shared agents and their grants) inside its own transaction, then applies the
// first step and the cutover as the installer does, each in its stage. Cases: an install with none, with old agents, with
// a person holding a key, with an identity that cannot be told; the previous release's writes on the first step's schema;
// a backup from before the cutover restored after it; and a cutover that meets a person recorded as an agent.
const first = readFileSync('supabase/migrations/20270418000000_legacy_role_agents.sql', 'utf8');
const cutover = readFileSync('supabase/migrations/20270418000001_legacy_role_agents_cutover.sql', 'utf8');
const rs = '10000000-0000-0000-0000-000000000001';
const owner = '20000000-0000-0000-0000-000000000001';
// Old agents that never signed in: one shared role agent with a grant, one member that held a key from the name match.
const agent = 'f6950000-0000-0000-0000-000000000001', keyed = 'f6950000-0000-0000-0000-000000000002';
// A person who signed in and held a key by mistake, and one recorded as a shared agent who signed in too.
const person = 'f6950000-0000-0000-0000-000000000003', unsure = 'f6950000-0000-0000-0000-000000000004';
const people = `insert into auth.users(id,email,last_sign_in_at) values
 ('${agent}','writer-agent@example.test',null),('${keyed}','designer-agent@example.test',null),
 ('${person}','person-with-key@example.test',now()),('${unsure}','signed-in-agent@example.test',now());
insert into public.people(id,name) values ('${agent}','الكاتب'),('${keyed}','المصمم'),('${person}','Hermes Person'),('${unsure}','الناقد');`;
const sql = `begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
${roleAgentsAsTheyStood}

-- An install with none: the first step changes no membership.
create temporary table members_before as select company_id,person_id,role,removed_at from public.members;
${first.replace('create function public.settle_legacy_role_agents', 'create or replace function public.settle_legacy_role_agents')}
select is((select count(*)::int from public.members m join members_before b using(company_id,person_id) where m.removed_at is not distinct from b.removed_at and m.role=b.role),
 (select count(*)::int from members_before),'an install with no role agent keeps every membership as it was');
select ok(to_regclass('public.agents') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='agent_role'),
 'the first step takes nothing away: the previous release reads its tables and the key');

-- An install with old agents, a person holding a key and a Card comment each wrote: the first step again.
${people}
insert into public.members(company_id,person_id,role,agent_role) values ('${rs}','${agent}','contributor','writer'),('${rs}','${keyed}','contributor','designer'),('${rs}','${person}','contributor','account_manager');
insert into public.agents(id,role) values ('${agent}','writer');
insert into public.agent_grants(company_id,agent_id) values ('${rs}','${agent}');
insert into public.work_comments(company_id,card_id,body,author_id) select '${rs}',min(id),'old agent note 695','${agent}' from public.work_cards where company_id='${rs}';
select lives_ok($$select public.settle_legacy_role_agents()$$,'the rows are settled');
select ok((select removed_at is not null from public.members where company_id='${rs}' and person_id='${agent}')
 and (select removed_at is not null from public.members where company_id='${rs}' and person_id='${keyed}'),'an old agent''s membership is marked removed, shared or keyed');
select is((select count(*)::int from auth.users where id in ('${agent}','${keyed}') and banned_until='infinity'),2,'and it can no longer sign in');
select is((select count(*)::int from public.people where id in ('${agent}','${keyed}')),2,'its people row stays for names');
select is((select p.name from public.work_comments c join public.people p on p.id=c.author_id where c.body='old agent note 695'),'الكاتب','what it wrote keeps its name');
select ok((select removed_at is null and agent_role is null from public.members where company_id='${rs}' and person_id='${person}'),'a person who held a key keeps the membership and loses the key');
select is((select banned_until from auth.users where id='${person}'),null,'and signs in as before');
select ok(public.channel_person('${rs}','${person}'),'the person is in channels like anyone');
select ok(not public.channel_person('${rs}','${agent}'),'an old agent is in no channel');
select is((select name from public.conversation_addressee('${rs}','@Hermes Person can you look?')),'Hermes Person','the person is mentioned');
select is((select count(*)::int from public.conversation_addressee('${rs}','@الكاتب look')),0,'an old agent is not');
select is(public.log_actor_kind('${rs}','${person}'),'person','the person''s new log rows are a person''s');

-- The previous release on the first step's schema: its Members page writes a key, and its Agents page a grant.
select lives_ok($$update public.members set agent_role='critic' where company_id='${rs}' and person_id='${person}'$$,'the previous release still writes a role key');
select lives_ok($$update public.agent_grants set revoked_at=null where company_id='${rs}' and agent_id='${agent}'$$,'and a grant');

-- One that cannot be told: recorded as a shared agent, and it signed in. The update stops with its name; nothing changes.
insert into public.members(company_id,person_id,role) values ('${rs}','${unsure}','contributor');
insert into public.agents(id,role) values ('${unsure}','critic');
savepoint refused;
select throws_like($$select public.settle_legacy_role_agents()$$,'%الناقد signed in as a person but is recorded as a legacy role agent%','an identity that cannot be told stops the update with its name');
select ok((select agent_role='critic' from public.members where company_id='${rs}' and person_id='${person}'),'and changes nothing');
-- The cutover meets it too: it refuses to run while a row belongs to a person, and drops nothing.
select throws_like($cut$${cutover.replace(/\$\$/g, '$q$')}$cut$,'%الناقد signed in as a person%','the cutover refuses while a role agent''s row belongs to a person');
select ok(to_regclass('public.agents') is not null and to_regclass('public.agent_grants') is not null,'and drops nothing');
rollback to savepoint refused;
delete from public.agents where id='${unsure}';

-- The cutover, as after a backup from before it was restored: it settles what the previous release wrote, then removes.
select lives_ok($cut$${cutover.replace(/\$\$/g, '$q$')}$cut$,'the cutover applies');
select ok((select removed_at is null from public.members where company_id='${rs}' and person_id='${person}'),'the person the previous release keyed is a Member still');
select ok(to_regclass('public.agents') is null and to_regclass('public.agent_grants') is null and to_regtype('public.member_agent_role') is null
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='agent_role'),'the tables, the key and its type are gone');
select is((select p.name from public.work_comments c join public.people p on p.id=c.author_id where c.body='old agent note 695'),'الكاتب','what the old agent wrote keeps its name after the drop');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
