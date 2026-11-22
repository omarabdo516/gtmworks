begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- #647. Ads in RS Learning: one Conversation of the Owner's and one message in the general channel, each with one Run
-- that writes its answer so far and then asks, or asks to be allowed an action, in the same message.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('f6470000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f6470000-0000-0000-0000-000000000001','Ads','Ads','said-test');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('f6470000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','f6470000-0000-0000-0000-000000000002','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','f6470000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000001','Omar','Which Agents do you advise?',gen_random_uuid(),'said-run');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Ads which Agents?','f6471000-0000-0000-0000-000000000001');
select set_config('test.message',(select id::text from public.channel_messages where send_key='f6471000-0000-0000-0000-000000000001'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,company_id,channel_id,'f6470000-0000-0000-0000-000000000002','Ads',gen_random_uuid(),body,'said-channel-run','said-test',1,now()
 from public.channel_messages where send_key='f6471000-0000-0000-0000-000000000001';
set local role service_role;

-- A Conversation: the question's card keeps the words its message carried; a later read changes nothing.
select is(public.track_run_question('f6470000-0000-0000-0000-000000000003','said-run','{"id":"q1@1","text":"Which do we make now?","choices":["Writer","Analyst"],"multiple":false,"said":"Five Agents I advise: Writer, Analyst."}',false,'2026-06-10T10:00:00Z'),'[]'::jsonb,'the question is kept');
select public.track_run_question('f6470000-0000-0000-0000-000000000003','said-run','{"id":"q1@1","text":"Which do we make now?","choices":["Writer","Analyst"],"multiple":false,"said":"Five Agents I advise: Writer, Analyst."}',false,'2026-06-10T10:00:05Z');
reset role;
select results_eq($$select said from public.reply_cards where conversation_id='f6470000-0000-0000-0000-000000000003' order by id$$,
 array['Five Agents I advise: Writer, Analyst.'],'its card keeps the words once');
set local role service_role;
-- A second pause of the same message carries the same words: they are drawn once, on the first card.
select public.track_run_question('f6470000-0000-0000-0000-000000000003','said-run','{"id":"q2@1","text":"And which first?","choices":["Writer","Analyst"],"multiple":false,"said":"Five Agents I advise: Writer, Analyst."}',false,'2026-06-10T10:01:00Z');
select public.track_run_permission('f6470000-0000-0000-0000-000000000003','said-run','{"id":"p1","description":"make the Writer","command":"","choices":["once","deny"],"said":"Five Agents I advise: Writer, Analyst."}',false,'2026-06-10T10:01:00Z');
reset role;
select results_eq($$select kind,said from public.reply_cards where conversation_id='f6470000-0000-0000-0000-000000000003' order by id$$,
 $$values ('question'::text,'Five Agents I advise: Writer, Analyst.'::text),('question',null),('permission',null)$$,'the same words are not kept on a second card of the Run');
set local role service_role;
-- A request with words of its own keeps them; none, only spaces or anything but text keeps nothing.
select public.track_run_permission('f6470000-0000-0000-0000-000000000003','said-run','{"id":"p2","description":"delete the old exports","command":"rm -r /srv/exports","choices":["once","deny"],"said":"The exports are 4 GB of old files."}',false,'2026-06-10T10:02:00Z');
select public.track_run_permission('f6470000-0000-0000-0000-000000000003','said-run','{"id":"p3","description":"delete the old drafts","command":"","choices":["once","deny"],"said":"   "}',false,'2026-06-10T10:03:00Z');
select public.track_run_permission('f6470000-0000-0000-0000-000000000003','said-run','{"id":"p4","description":"delete the old backups","command":"","choices":["once","deny"],"said":42}',false,'2026-06-10T10:04:00Z');
reset role;
select results_eq($$select title,said from public.reply_cards where conversation_id='f6470000-0000-0000-0000-000000000003' and kind='permission' order by id$$,
 $$values ('make the Writer'::text,null::text),('delete the old exports','The exports are 4 GB of old files.'),('delete the old drafts',null),('delete the old backups',null)$$,'a request keeps only its own words, as text');
set local role service_role;
select is(public.said_before('{"said":"a"}'),'a','words are read as sent');
select is(public.said_before(jsonb_build_object('said',repeat('x',200001))),null,'nothing longer than a reply is kept');

-- A Channel: the question's card and a request of the same Run keep their words once, across both kinds of card.
select public.track_channel_question(current_setting('test.message')::bigint,'said-channel-run','{"id":"cq1","text":"Which do we make now?","choices":["Writer","Analyst"],"multiple":false,"said":"Five Agents I advise."}',false,'2026-06-10T10:00:00Z');
reset role;
select results_eq($$select said from public.reply_cards where channel_message_id=current_setting('test.message')::bigint$$,array['Five Agents I advise.'],'a channel question keeps its words');
set local role service_role;
select public.track_channel_permission(current_setting('test.message')::bigint,'said-channel-run','{"id":"cp1","description":"make the Writer","command":"","choices":["once","deny"],"said":"Five Agents I advise."}',false,'2026-06-10T10:01:00Z');
select public.track_channel_permission(current_setting('test.message')::bigint,'said-channel-run','{"id":"cp2","description":"delete the old exports","command":"","choices":["once","deny"],"said":"The exports are 4 GB."}',false,'2026-06-10T10:02:00Z');
reset role;
select results_eq($$select title,said from public.channel_permissions where message_id=current_setting('test.message')::bigint order by id$$,
 $$values ('make the Writer'::text,null::text),('delete the old exports','The exports are 4 GB.')$$,'a channel request keeps only words no card of its Run already carries');
set local role service_role;
select public.track_channel_question(current_setting('test.message')::bigint,'said-channel-run','{"id":"cq2","text":"Which first?","choices":["Writer","Analyst"],"multiple":false,"said":"The exports are 4 GB."}',false,'2026-06-10T10:03:00Z');
reset role;
select results_eq($$select said from public.reply_cards where channel_message_id=current_setting('test.message')::bigint order by id$$,array['Five Agents I advise.',null],'nor does a channel question');

-- Only the worker keeps them, and the readers of the chat read them.
reset role;
select ok(not has_function_privilege('authenticated','public.said_before(jsonb)','execute') and not has_function_privilege('authenticated','public.channel_run_said(bigint,text,text)','execute'),'no signed-in person calls the helpers');
select ok(has_column_privilege('authenticated','public.reply_cards','said','select') and has_column_privilege('authenticated','public.channel_permissions','said','select'),'the chat reads the words with its cards');
select ok(not has_column_privilege('authenticated','public.reply_cards','said','update') and not has_column_privilege('authenticated','public.channel_permissions','said','update'),'no signed-in person writes them');
select * from finish();
rollback;
