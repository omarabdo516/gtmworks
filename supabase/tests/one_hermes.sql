begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #342: the bundled Hermes is the only Hermes. The pasted Connections, the Agent audit table beside the company log and
-- the previous version's bundled provider are gone; each Agent names its own profile, and an Agent change is still logged.
select hasnt_table('public','hermes_connections','Hermes connections are dropped');
select hasnt_table('public','hermes_agent_audit','the Agent audit table is dropped');
select hasnt_function('public',f,f||' is dropped') from unnest(array['is_bundled_connection','bundled_hermes_waiting','provide_bundled_hermes',
 'log_agent_change','guard_attached_hermes_profile','keep_reserved_connection','keep_hermes_destination','guard_agent_profile_connection',
 'guard_company_profile_connection','guard_shared_space_connection']) f;
select has_column('public','hermes_agents','profile','an Agent names its own profile');
select is((select count(*)::int from pg_proc where pronamespace='public'::regnamespace and (prosrc ~ '\m(hermes_connections|is_bundled_connection)\M' or prosrc ~ 'public\.hermes_agent_audit')),0,
 'no function reads or writes a dropped table');
-- The company log keeps naming its Agent lines by the old source, so earlier ones stay as they were.
select is((select count(*)::int from pg_constraint where confrelid=0 and contype='f'),0,'no foreign key is left pointing nowhere');

-- An Owner's change to an Agent reaches the company log as before.
insert into public.hermes_agents(company_id,name,speciality,profile) values
 ('10000000-0000-0000-0000-000000000001','Scout','Research','co-10000000000000000000000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',(select id from public.hermes_agents where name='Scout'))$$,
 'an Owner makes an Agent the main one');
reset role;
select is((select concat_ws('|',action,details->>'agent_name') from public.company_log where agent_id=(select id from public.hermes_agents where name='Scout') order by id desc limit 1),
 'agent_made_main|Scout','the change is in the company log');
select * from finish();
rollback;
