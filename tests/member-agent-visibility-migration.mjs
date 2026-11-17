import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// An install updated to per-Member Agent visibility (#15): every Member keeps the Agents they saw before the update.
const migration=readFileSync('supabase/migrations/20261216150000_member_agent_visibility.sql','utf8');
const verify=readFileSync('supabase/migrations/20261216150000_member_agent_visibility.verify.sql','utf8').trim().replace(/;$/,'');
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- RS Learning has Lead (main) and Ads; Aleem has its own Lead and Writer. The Viewer (…04) has left RS Learning.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
 ('f1510000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','backfill-1','ciphertext','connected'),
 ('f1510000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','backfill-2','ciphertext','connected'),
 ('f1510000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://localhost','backfill-3','ciphertext','connected'),
 ('f1510000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://localhost','backfill-4','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a1510000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000001','Lead','General',true),
 ('a1510000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('a1510000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','f1510000-0000-0000-0000-000000000003','Lead','General',true),
 ('a1510000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','f1510000-0000-0000-0000-000000000004','Writer','Writing',false);
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004';
delete from public.member_agent_access;
${migration}
select is((select string_agg(right(a.person_id::text,1)||':'||h.name,',' order by h.name,a.person_id) from public.member_agent_access a join public.hermes_agents h on h.id=a.agent_id
 where a.person_id::text like '20000000-%'),'2:Ads,3:Ads,5:Ads,5:Writer','every active Member keeps each Agent beside the main one, in their own Companies');
select is((select count(*)::int from public.member_agent_access a join public.hermes_agents h on h.id=a.agent_id where h.is_default),0,'no row for a main Agent, which every Member sees');
select is((select count(*)::int from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000001'),0,'no row for the Owner, who sees every Agent');
${migration}
select is((select count(*)::int from public.member_agent_access where person_id::text like '20000000-%'),4,'running the update again changes nothing');
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value<>'true'),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
testDb(import.meta.url,sql);
