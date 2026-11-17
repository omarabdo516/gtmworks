-- #172. Omar's chat with Ads about the Meta campaign (the reference's th-meta) while its record is slow, for the Design compare workflow's loading screen of the same name: applied by the workflow
-- before the capture, into that run's own fresh database only (design/COMPARE.md). The restrictive policy slows the one
-- table the waiting part reads for 7s, under the signed-in role's 8s statement timeout; a row filter is only weighed on
-- rows a read finds, so the table holds a row the reader sees.
begin;
-- Refuse every database but the seeded local one: it must hold the seed's Omar and its public test-only agent key,
-- which no real installation has. The whole file is one transaction, so a refusal writes nothing.
do $$ begin
 if not exists(select 1 from auth.users where id='20000000-0000-0000-0000-000000000001' and email='omar@example.com')
  or not exists(select 1 from public.agent_keys where key_hash='f0358ec2fdc223a1ac2213a6e4b2cec6efe6d175ec823cb2a574e15ecdcf8226') then
  raise exception 'design-compare loading screen: only for the seeded local database (supabase/seed.sql)';
 end if;
end $$;
set local session_replication_role = replica;
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('6f000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-loading','visual-loading','visual-no-key','unreachable') on conflict do nothing;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('6f000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000001','Ads','Runs the Meta and Google ads.') on conflict do nothing;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('6f000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000002','Ads','2026-06-10T10:00:00Z') on conflict do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000001',null,'Omar','خطة إعلانات Meta لكورس المحاسب الشامل','6f000000-0000-0000-0000-000000000004','visual-loading','2026-06-10T10:00:00Z'),
 ('10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000003','agent',null,'6f000000-0000-0000-0000-000000000002','Ads','تمام، هبدأ بالجمهور وبعدها أكتب 3 إعلانات وأبعتهملك تشوفهم.',null,'visual-loading','2026-06-10T10:01:00Z') on conflict do nothing;
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens,recorded_at) values ('10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000003','visual-loading','completed',1200,300,'2026-06-10T10:01:00Z') on conflict do nothing;
create policy test_slow_read on public.conversation_usage as restrictive for select to authenticated using ((select pg_sleep(7)) is not null);
commit;
