-- #642: a Run that ran out of every account it could use keeps when its usage resets, beside its end, written only by
-- the worker's closer in the same call that closes the Run, never changed, and read only by the Conversation's own person.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
select ok((select relrowsecurity from pg_class where oid='public.conversation_run_resets'::regclass),'usage resets keep row-level security');

insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000021','Mona','Writing',true,'writer');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.send_conversation_message('e2000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000021','Message '||n,('e3000000-0000-0000-0000-00000000002'||n)::uuid,'run_'||n) from generate_series(1,3) n;
select throws_ok($$select public.close_conversation_run_out_of_usage('e2000000-0000-0000-0000-000000000021','run_1',null,false,now()+interval '5 days')$$,'42501',null,'a person cannot close a Run');

reset role;
select is(public.close_conversation_run_out_of_usage('e2000000-0000-0000-0000-000000000021','run_1',null,false,'2027-05-01 19:24+00'),true,'the worker closes a Run that ran out of usage');
select is((select outcome from public.conversation_run_ends where run_id='run_1'),'no_access','its end is no access');
select is((select resets_at from public.conversation_run_resets where run_id='run_1'),'2027-05-01 19:24+00'::timestamptz,'and when its usage resets is kept');
select is(public.close_conversation_run_out_of_usage('e2000000-0000-0000-0000-000000000021','run_1',null,false,'2027-05-02 00:00+00'),false,'closing it again is harmless');
select is((select resets_at from public.conversation_run_resets where run_id='run_1'),'2027-05-01 19:24+00'::timestamptz,'and keeps the first reset');
select is(public.close_conversation_run_out_of_usage('e2000000-0000-0000-0000-000000000021','run_2',null,false,null),true,'a Run whose Engine named no reset closes as no access');
select is((select count(*)::int from public.conversation_run_resets where run_id='run_2'),0,'with no reset kept');
select throws_ok($$update public.conversation_run_resets set resets_at=now()$$,'42501','conversationAppendOnly','usage resets are append-only');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_run_resets),0,'a Manager reads no other person''s usage resets');
select * from finish();
rollback;
