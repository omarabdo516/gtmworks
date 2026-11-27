begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
-- #754: the state read of #699, read once for all the reader's Agents (20270416000008), still finds a failure where only
-- some readers see it: a Handover leg in a Conversation or a channel. A note Run on an old board's Card is no failure
-- since the old board was switched off (#846): no one can open the old Card to see it. agent_face_states.sql holds every
-- other case. The Contributor (…03) is shown Maker, Helper, Planner and Scout; Hidden is hidden from them.
--  Maker    its note Run failed on its own old Card: stuck to no one
--  Helper   its note Run failed on Hidden's old Card: stuck to no one
--  Planner  Lead handed it work in the Owner's Conversation and its leg failed: stuck to the Owner only
--  Scout    it handed work on in the general channel and its follow-up failed: stuck to both, who are both in it
--  Lead     its last leg there completed: idle
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile)
 select ('a7540000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'10000000-0000-0000-0000-000000000001',
  ('f7540000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,name,name,n=1,'default'
 from unnest(array['Lead','Maker','Helper','Planner','Scout','Hidden']) with ordinality x(name,n);
create temp table named(name text primary key, agent uuid) on commit drop;
insert into named select name,id from public.hermes_agents where id::text like 'a7540000-%';
grant select on named to authenticated;
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',agent from named
 where name in ('Maker','Helper','Planner','Scout');
insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value
 select x.id,'10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1),x.title,n.agent
 from (values (-7541::bigint,'Maker card','Maker'),(-7542,'Hidden card','Hidden')) x(id,title,owner) join named n on n.name=x.owner;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select 'b7540000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',agent,name
 from named where name='Lead';

set local session_replication_role=replica;
insert into public.work_comments(id,company_id,card_id,body,author_id,created_at) overriding system value values
 (-7541,'10000000-0000-0000-0000-000000000001',-7541,'@Maker go','20000000-0000-0000-0000-000000000001',now()-interval '2 hours'),
 (-7542,'10000000-0000-0000-0000-000000000001',-7542,'@Helper go','20000000-0000-0000-0000-000000000001',now()-interval '2 hours');
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input,created_at,outcome,closed_at)
 select x.note,'10000000-0000-0000-0000-000000000001',x.note,n.agent,n.name,gen_random_uuid(),'go',now()-interval '2 hours','failed',now()-interval '1 hour'
 from (values (-7541::bigint,'Maker'),(-7542,'Helper')) x(note,who) join named n on n.name=x.who;
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,target_closed_at,closed_at,created_at)
 select '10000000-0000-0000-0000-000000000001','b7540000-0000-0000-0000-000000000001','lead-1','call-1',
  (select agent from named where name='Lead'),(select agent from named where name='Planner'),'Plan it','failed','failed',
  now()-interval '30 minutes',now()-interval '30 minutes',now()-interval '40 minutes';
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key,created_at) overriding system value values
 (-7541,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Scout go',gen_random_uuid(),now()-interval '50 minutes');
insert into public.agent_handovers(company_id,channel_message_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,summary,target_closed_at,follow_up_outcome,closed_at,created_at)
 select '10000000-0000-0000-0000-000000000001',-7541,'scout-1','call-2',
  (select agent from named where name='Scout'),(select agent from named where name='Lead'),'Ask Lead','failed','completed','Done',
  now()-interval '25 minutes','failed',now()-interval '20 minutes',now()-interval '45 minutes';
set local session_replication_role=origin;

create function pg_temp.states() returns table(name text, state text) language sql as $$
 select n.name,s.state from public.agent_face_states('10000000-0000-0000-0000-000000000001') s join named n on n.agent=s.agent order by n.name;
$$;
grant execute on function pg_temp.states() to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select * from pg_temp.states()$$,
 $$values ('Helper','idle'),('Hidden','idle'),('Lead','idle'),('Maker','idle'),('Planner','stuck'),('Scout','stuck')$$,
 'the Owner sees every failure, a Handover leg in their Conversation and a follow-up in the general channel, and no note Run''s on an old Card');
select results_eq($$select failed_at,failed_card from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent in (select agent from named where name in ('Helper','Maker'))$$,
 $$values (null::timestamptz,null::bigint),(null,null)$$,'a note Run''s failure on an old Card names no failure and no Card');
select results_eq($$select failed_conversation,failed_channel from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Planner')$$,
 $$values ('b7540000-0000-0000-0000-000000000001'::uuid,null::uuid)$$,'a Handover leg''s failure names the Conversation it ran in');
select results_eq($$select failed_conversation,failed_channel from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Scout')$$,
 $$values (null::uuid,'69000000-0000-0000-0000-000000000001'::uuid)$$,'a follow-up''s failure names the channel it ran in');
select ok((select last_work_at >= now()-interval '21 minutes' from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Lead')),
 'a leg handed to Lead is its work, ended when the leg closed');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select * from pg_temp.states()$$,
 $$values ('Helper','idle'),('Lead','idle'),('Maker','idle'),('Planner','idle'),('Scout','stuck')$$,
 'the Contributor sees a failure in a channel they see, not in a Conversation they do not, and none on an old Card');

select * from finish();
rollback;
