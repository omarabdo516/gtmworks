begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
-- #765: an Agent's turn in a Channel whose start the Engine refused (failed, no Run named) reads as not started, and the
-- message's own person puts that same turn back to never started; nobody else may, and a turn that ran is not retried.
-- RS Learning's general channel: Omar (1) is Owner, 3 a Contributor, 4 a Viewer.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7650000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7650000-0000-0000-0000-000000000001','Caller','General',false,'default');
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (976501,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Caller plan it','d7650000-0000-0000-0000-000000000001');
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,outcome,closed_at) values
 (976501,1,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a7650000-0000-0000-0000-000000000001','Caller',gen_random_uuid(),'Omar: @Caller plan it',1,now(),'failed',now());
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select started from public.channel_runs where message_id=976501),false,'a refused start reads as never started');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.retry_channel_run('69000000-0000-0000-0000-000000000001',976501,1::smallint)$$,'P0002',null,'another Member cannot try someone else''s message again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.retry_channel_run('69000000-0000-0000-0000-000000000001',976501,1::smallint),true,'its own person tries it again');
reset role;
select is((select (outcome is null and attempts=0 and closed_at is null) from public.channel_runs where message_id=976501),true,'the same turn waits as never started');
select is((select count(*)::int from public.channel_messages where channel_id='69000000-0000-0000-0000-000000000001' and send_key='d7650000-0000-0000-0000-000000000001'),1,'and no second message was made');
set local role authenticated;
select is(public.retry_channel_run('69000000-0000-0000-0000-000000000001',976501,1::smallint),false,'a turn already waiting is not retried');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.retry_channel_run('69000000-0000-0000-0000-000000000001',976501,1::smallint)$$,null,null,'a Viewer may not');
select * from finish();
rollback;
