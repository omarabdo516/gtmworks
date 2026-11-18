-- #347 (decision 0042): token use is read from Hermes, so gtmworks keeps no count. conversation_usage, its per-day
-- reader and its reply trigger are gone, and channel and note Runs keep no tokens. How each Run ended stays, in
-- conversation_run_ends (the chat record's "did not finish"), with the same separation: only the conversation's own
-- person reads it, in their own company.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);
select hasnt_table('public','conversation_usage','conversation_usage is gone');
select hasnt_function('public','usage_by_day','the per-day usage reader is gone');
select hasnt_function('public','record_reply_usage','the reply''s usage trigger is gone');
select hasnt_column('public','conversation_run_ends','input_tokens','a Run''s end keeps no input tokens');
select hasnt_column('public','conversation_run_ends','output_tokens','nor output tokens');
select hasnt_column('public','channel_runs','input_tokens','a channel Run keeps no input tokens');
select hasnt_column('public','channel_runs','output_tokens','nor output tokens');
select hasnt_column('public','note_runs','input_tokens','a note Run keeps no input tokens');
select hasnt_column('public','note_runs','output_tokens','nor output tokens');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.prosrc ilike '%conversation_usage%' or p.prosrc ilike '%input_tokens%')),0,'no function reads or writes usage');
select ok((select relrowsecurity from pg_class where oid='public.conversation_run_ends'::regclass),'Run ends keep row-level security');

insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
 ('e0000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','writer','ciphertext','connected'),
 ('e0000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://localhost','aleem','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('e1000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000011','Mona','Writing',true),
 ('e1000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000013','Sara','Writing',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.send_conversation_message('e2000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Message '||n,('e3000000-0000-0000-0000-00000000001'||n)::uuid,'run_'||n) from generate_series(1,5) n;
select public.send_conversation_message('e2000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000013','Aleem','e3000000-0000-0000-0000-000000000019','run_9');

-- The previous app version still sends Hermes's numbers; they are not kept.
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_1','completed','First reply','session_1',14000,12)$$,'a completed run records its reply and its end');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_1','completed','Again','session_1',1,1)$$,'reading the same run again is harmless');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_3','stopped',null,null,900,7)$$,'a stopped run records its end');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_4','lost',null,null,null,null)$$,'a lost run records its end');
reset role;
select is(public.close_conversation_run('e2000000-0000-0000-0000-000000000011','run_2','failed',null,null,5,5,false),true,'the worker''s close records a failed end');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.record_conversation_reply('e2000000-0000-0000-0000-000000000011','run_5','A reply saved the old way','session_1');
select is((select string_agg(run_id||':'||outcome,',' order by run_id) from public.conversation_run_ends where conversation_id='e2000000-0000-0000-0000-000000000011'),'run_1:completed,run_2:failed,run_3:stopped,run_4:lost,run_5:completed','each Run''s end is kept once, a reply saved the old way as completed');
select is((select string_agg(author||':'||body,',' order by id) from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000011' and author='agent'),'agent:First reply,agent:A reply saved the old way','one reply per completed run');
select throws_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_forged','stopped',null,null,null,null)$$,'P0002','conversationNotFound','an end needs a run of one of the conversation''s messages');
select public.record_conversation_run('e2000000-0000-0000-0000-000000000013','run_9','completed','Aleem reply','session_9',null,null);
reset role;
select throws_ok($$update public.conversation_run_ends set outcome='failed'$$,'42501','conversationAppendOnly','Run ends are append-only');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_run_ends),0,'a Manager reads no other person''s Run ends');
select throws_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_1','completed','Forged','s',null,null)$$,'P0002','conversationNotFound','nor records one in another person''s conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(distinct company_id::text,',') from public.conversation_run_ends),'10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000003','their person reads the ends in each of their own companies');
select * from finish();
rollback;
