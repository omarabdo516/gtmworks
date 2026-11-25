begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- #470. RS Learning: Lead on the Company's own profile and Reach (made from the meta role) on a profile of its own. The
-- Owner sends /campaign in Lead's chat; Reach's Run asks a question, then waits to be allowed to act.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a4700000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions,template) values
 ('a4700000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f4700000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.',null),
 ('a4700000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f4700000-0000-0000-0000-000000000012','Reach','Meta ads',false,'ag-a4700000000000000000000000000012','Run the Meta ads.','meta');
insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true) on conflict do nothing;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c4700000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a4700000-0000-0000-0000-000000000011','Lead');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.command_handover('c4700000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'a4700000-0000-0000-0000-000000000011','d4700000-0000-0000-0000-000000000001','/campaign Launch the December ads','meta','Launch the December ads'),true,
 'the Owner''s command is handed to Reach');
select set_config('request.jwt.claim.sub','',true);
reset role;
-- The worker started Reach's Run (begin_handover, answer_handover), and a #317 job from Lead to Reach runs in the same chat.
update public.agent_handovers set state='target',target_run='run-470',target_attempts=1 where run_id='command:d4700000-0000-0000-0000-000000000001';
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_run,target_attempts)
 values('10000000-0000-0000-0000-000000000001','c4700000-0000-0000-0000-000000000001','run-lead','call-1',
  'a4700000-0000-0000-0000-000000000011','a4700000-0000-0000-0000-000000000012','Plan the ads','target','run-317',1);
-- The worker's role reads no handover row: each is named by its id here.
create temp table handed on commit drop as select (select id from public.agent_handovers where answers_person) command,(select id from public.agent_handovers where run_id='run-lead') job;
grant select on handed to service_role;
create temp view cards as select id,kind from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001';
grant select on cards to service_role;

set local role service_role;
select matches(public.command_handover_job((select command from handed)),
 E'^The person in this chat used a command that is your job\\.\n\nThe job:\nLaunch the December ads\n\n.*They read this chat: when you need something only they can tell you, ask them',
 'the command''s Agent is asked the person''s job, and told it may ask them in the chat');
select is(public.command_handover_job((select job from handed)),null,'a #317 job is no command''s');
select is(public.track_handover_question((select job from handed),'run-317',
 '{"id":"q0","text":"Which budget?","choices":[],"multiple":false}'::jsonb,false,now()),null,
 'a #317 job''s question is no card: nobody reads that Agent''s chat, and the worker answers it empty');
select is(public.track_handover_question((select command from handed),'run-other',
 '{"id":"q0","text":"Which budget?","choices":[],"multiple":false}'::jsonb,false,now()),'[]'::jsonb,
 'a read of another Run keeps nothing');
select is(public.track_handover_question((select command from handed),'run-470',
 '{"id":"q1","text":"Which audience first?","choices":["Parents","Students"],"multiple":false,"said":"Two audiences fit."}'::jsonb,false,now()),'[]'::jsonb,
 'the command''s Agent asks, and nothing is answered yet');
reset role;
select is((select run_id||':'||kind||':'||state||':'||title||':'||said_before from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001'),
 'command:d4700000-0000-0000-0000-000000000001:question:open:Which audience first?:Two audiences fit.',
 'its question is the card of the command''s own Run in the chat, with what the Agent wrote above it');

-- The person answers it, as they answer the chat's own Agent.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_question('10000000-0000-0000-0000-000000000001','c4700000-0000-0000-0000-000000000001',
 (select id from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001'),0,null,'e4700000-0000-0000-0000-000000000001'),'claimed',
 'the person picks a choice');
select set_config('request.jwt.claim.sub','',true);
reset role;
set local role service_role;
select is((public.track_handover_question((select command from handed),'run-470',
 '{"id":"q1","text":"Which audience first?","choices":["Parents","Students"],"multiple":false}'::jsonb,false,now())->0)-'card',
 '{"question":"q1","answer":"Parents"}'::jsonb,'and the worker is handed the answer to deliver to that Run');
select is(public.settle_question((select id from cards where kind='question'),'answered'),'answered',
 'which closes the question once the Engine took it');

-- Then it waits to be allowed to act: once or deny, never always (no standing allow of the chat's Agent).
select is(public.track_handover_permission((select command from handed),'run-470',
 '{"id":"p1","description":"Publish the ad set","command":"ads publish","choices":["once","always","deny"],"allows":["ads publish"]}'::jsonb,false,now(),now()),'[]'::jsonb,
 'the command''s Agent asks to act');
select is(public.track_handover_permission((select job from handed),'run-317',
 '{"id":"p0","description":"Publish","command":"ads publish","choices":["once","deny"]}'::jsonb,false,now(),now()),null,
 'a #317 job''s request is no card, and the worker denies it');
reset role;
select is((select run_id||':'||state||':'||(content->'choices')::text from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001' and kind='permission'),
 'command:d4700000-0000-0000-0000-000000000001:open:["once", "deny"]','its request is the command''s Run''s card, offering once and deny');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_permission('10000000-0000-0000-0000-000000000001','c4700000-0000-0000-0000-000000000001',
 (select id from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001' and kind='permission'),'once')->>'state','decided',
 'the person allows it once');
select set_config('request.jwt.claim.sub','',true);
reset role;
set local role service_role;
select is((public.track_handover_permission((select command from handed),'run-470',
 '{"id":"p1","description":"Publish the ad set","command":"ads publish","choices":["once","always","deny"]}'::jsonb,false,now(),now())->0)-'card',
 '{"permission":"p1","choice":"once"}'::jsonb,'and the worker is handed the choice to deliver');

-- Reach answers; the handover ends, and Lead's next Run in the chat is told the job and the answer.
select is(public.close_handover_target((select command from handed),'run-470','completed','Launched for Parents: three ad sets.'),true,
 'Reach''s reply is the chat''s answer');
select is(public.track_handover_question((select command from handed),'run-470',
 '{"id":"q2","text":"Anything else?","choices":[],"multiple":false}'::jsonb,false,now()),'[]'::jsonb,
 'an ended handover keeps no card');
reset role;
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 values('c4700000-0000-0000-0000-000000000001','d4700000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f4700000-0000-0000-0000-000000000011',
  '20000000-0000-0000-0000-000000000001','a4700000-0000-0000-0000-000000000011','make it five ad sets','co-10000000000000000000000000000001');
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 values('c4700000-0000-0000-0000-000000000001','d4700000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
set local role service_role;
select is(public.pin_lead_brief('c4700000-0000-0000-0000-000000000001','d4700000-0000-0000-0000-000000000002')->'commands',
 '[{"job":"Launch the December ads","agent":"Reach","answer":"Launched for Parents: three ad sets.","outcome":"completed"}]'::jsonb,
 'Lead''s next Run carries the command''s job and what Reach answered; a #317 job is no command''s and is not listed');
reset role;
select is((select count(*)::int from public.reply_cards where conversation_id='c4700000-0000-0000-0000-000000000001' and state in ('open','sending')),0,
 'and nothing of the command''s Run is left open');

select * from finish();
rollback;
