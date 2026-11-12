begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
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

select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_1','completed','First reply','session_1',14000,12)$$,'a completed run records its reply and its usage');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_2','completed','Second reply','session_1',15000,20)$$,'a second run records its own');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_2','completed','Again','session_1',1,1)$$,'reading the same run again is harmless');
select is((select string_agg(author||':'||body,',' order by id) from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000011' and author='agent'),'agent:First reply,agent:Second reply','one reply per run');
select is((select sum(input_tokens)::int||'/'||sum(output_tokens)::int from public.conversation_usage where conversation_id='e2000000-0000-0000-0000-000000000011'),'29000/32','the conversation total is the sum of its runs');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_3','stopped',null,null,900,7)$$,'a stopped run records what Hermes reported');
select lives_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_4','lost',null,null,null,7)$$,'a lost run with no full report is recorded');
select is((select string_agg(run_id||':'||outcome||':'||coalesce(input_tokens::text,'unknown')||':'||coalesce(output_tokens::text,'unknown'),',' order by run_id) from public.conversation_usage where conversation_id='e2000000-0000-0000-0000-000000000011'),'run_1:completed:14000:12,run_2:completed:15000:20,run_3:stopped:900:7,run_4:lost:unknown:unknown','stopped keeps its tokens, lost is unknown, never zero');
select is((select count(*)::int from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000011' and author='agent'),2,'a stopped or lost run adds no reply');
select public.record_conversation_reply('e2000000-0000-0000-0000-000000000011','run_5','A reply saved the old way','session_1');
select is((select outcome||':'||coalesce(input_tokens::text,'unknown') from public.conversation_usage where run_id='run_5'),'completed:unknown','a reply saved without usage counts as unknown, not zero');
select throws_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_forged','stopped',null,null,1,1)$$,'P0002','conversationNotFound','usage needs a run of one of the conversation''s messages');
select public.record_conversation_run('e2000000-0000-0000-0000-000000000013','run_9','completed','Aleem reply','session_9',500,5);
select is((select string_agg(company_name||':'||input_tokens||':'||output_tokens||':'||unknown_runs,',' order by company_name) from public.usage_by_day()),'Aleem:500:5:0,RS Learning:29900:39:2','the Owner of both companies sees each one''s tokens per day');
reset role;
select throws_ok($$update public.conversation_usage set input_tokens=0$$,'42501','conversationAppendOnly','usage is append-only');
update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select string_agg(company_name||':'||input_tokens,',') from public.usage_by_day()),'RS Learning:29900','a company Owner sees only their own company');
select is((select count(*)::int from public.conversation_usage),0,'and no other person''s conversation usage rows');
select throws_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000011','run_1','completed','Forged','s',1,1)$$,'P0002','conversationNotFound','an Owner cannot record usage in another person''s conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.usage_by_day()),0,'a member who is not an Owner sees no usage');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.usage_by_day()),0,'nor does a member of two companies who owns neither');
select * from finish();
rollback;
