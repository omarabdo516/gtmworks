-- #172. Numbers while its figures are slow, for the Design compare workflow's loading screen of the same name: applied by the workflow
-- before the capture, into that run's own fresh database only (design/COMPARE.md). The restrictive policy slows the one
-- table the waiting part reads for 7s, under the signed-in role's 8s statement timeout; a row filter is only weighed on
-- rows a read finds, so the table holds a row the reader sees.
begin;
-- Refuse every database but the seeded local one: it must hold the seed's Omar and its RS Learning, by their fixed ids,
-- which no real installation has. The whole file is one transaction, so a refusal writes nothing.
do $$ begin
 if not exists(select 1 from auth.users where id='20000000-0000-0000-0000-000000000001' and email='omar@example.com')
  or not exists(select 1 from public.companies where id='10000000-0000-0000-0000-000000000001' and slug='rs-learning') then
  raise exception 'design-compare loading screen: only for the seeded local database (supabase/seed.sql)';
 end if;
end $$;
set local session_replication_role = replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('6f000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000005','Ads','Runs the Meta and Google ads.','visual-numbers') on conflict do nothing;
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
 select '10000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000006','agent','Ads','agent','6f000000-0000-0000-0000-000000000006','agent_changed','{"agent_name":"Ads"}','hermes_agent_audit',691172,now()-interval '1 hour'
 where not exists(select 1 from public.company_log where source='hermes_agent_audit' and source_id=691172);
create policy test_slow_read on public.company_log as restrictive for select to authenticated using ((select pg_sleep(7)) is not null);
commit;
