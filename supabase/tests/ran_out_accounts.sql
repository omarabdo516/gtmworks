-- #731: a Run that ran out of every account it could use keeps which of its provider's accounts ran out, beside its end,
-- written only by the worker's closer in the same call that closes the Run, only for the Run's own provider, never
-- changed, and read only by the Conversation's own person.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
select ok((select relrowsecurity from pg_class where oid='public.conversation_run_ran_out'::regclass),'accounts that ran out keep row-level security');

insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000031','Mona','Writing',true,'writer');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.send_conversation_message('e2000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000031','Message '||n,('e3000000-0000-0000-0000-00000000003'||n)::uuid,'run_'||n) from generate_series(1,4) n;
select throws_ok($$select public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_1',null,false,null,'openai-codex','[]')$$,'42501',null,'a person cannot close a Run');

reset role;
-- run_3 was started on a model the Owner chose for the Conversation (#158): Claude.
insert into public.conversation_run_notes(conversation_id,send_key,company_id,model) values
 ('e2000000-0000-0000-0000-000000000031','e3000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000001','{"provider":"anthropic","model":"claude-sonnet-4-6"}')
 on conflict (conversation_id,send_key) do update set model=excluded.model;
select is(public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_1',null,false,'2027-05-01 19:24+00','openai-codex',
 '[{"provider":"openai-codex","account":"c0dex1","place":1},{"provider":"openai-codex","account":"c0dex2","place":2},{"provider":"anthropic","account":"c1aude","place":1},{"provider":"openai-codex","account":"bad id","place":3},"odd"]'),
 true,'the worker closes a Run that ran out of usage');
select is((select outcome from public.conversation_run_ends where run_id='run_1'),'no_access','its end is no access');
select is((select resets_at from public.conversation_run_resets where run_id='run_1'),'2027-05-01 19:24+00'::timestamptz,'when its usage resets is kept');
select results_eq($$select provider,account,place from public.conversation_run_ran_out where run_id='run_1' order by place$$,
 $$values ('openai-codex','c0dex1',1),('openai-codex','c0dex2',2)$$,'and only its own provider''s accounts that ran out, in their places');
select is(public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_1',null,false,null,'openai-codex','[{"provider":"openai-codex","account":"other","place":3}]'),false,'closing it again is harmless');
select is((select count(*)::int from public.conversation_run_ran_out where run_id='run_1'),2,'and keeps the first accounts');
select is(public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_2',null,false,null,'openai-codex',null),true,'a Run whose pool could not be read closes as no access');
select is((select count(*)::int from public.conversation_run_ran_out where run_id='run_2'),0,'with no account kept');
select is(public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_3',null,false,null,'openai-codex',
 '[{"provider":"openai-codex","account":"c0dex1","place":1},{"provider":"anthropic","account":"c1aude","place":1}]'),true,'a Run on a chosen model closes');
select results_eq($$select provider,account from public.conversation_run_ran_out where run_id='run_3'$$,$$values ('anthropic','c1aude')$$,'and keeps the chosen model''s accounts, not the Agent''s');
-- run_4: a place of another shape is left out without stopping the close, and an account the Owner switched off is never
-- named: the Run could not have used it.
insert into public.provider_order(company_id,provider,account,enabled) values ('10000000-0000-0000-0000-000000000001','openai-codex','c0dex3',false);
select is(public.close_conversation_run_ran_out('e2000000-0000-0000-0000-000000000031','run_4',null,false,null,'openai-codex',
 '[{"provider":"openai-codex","account":"c0dex1","place":"x"},{"provider":"openai-codex","account":"c0dex2","place":1.5},{"provider":"openai-codex","account":"c0dex3","place":3},{"provider":"openai-codex","account":"c0dex4","place":4}]'),
 true,'a Run with odd places closes');
select results_eq($$select account,place from public.conversation_run_ran_out where run_id='run_4'$$,$$values ('c0dex4',4)$$,'and keeps only the well-formed accounts the Owner left on');
select throws_ok($$update public.conversation_run_ran_out set place=5$$,'42501','conversationAppendOnly','accounts that ran out are append-only');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_run_ran_out),0,'a Manager reads no other person''s accounts that ran out');
select * from finish();
rollback;
