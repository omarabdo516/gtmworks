begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #146. Ads in RS Learning, shown to the first Contributor (3, whose two chats these are), the second Contributor (5) and
-- the Viewer (4), and hidden from the Manager (2). Chat T has a Card In progress, tied as conversation_reply_card ties
-- one; chat U has none. Someone outside RS Learning, a Contributor of R&S Consultations only, tries the same reads.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('c1460000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','card-waits-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('c1460000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c1460000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'c1460000-0000-0000-0000-000000000002'
 from unnest(array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005']::uuid[]) p;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e1460000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','c1460000-0000-0000-0000-000000000002','Ads'),
 ('e1460000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','c1460000-0000-0000-0000-000000000002','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e1460000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','Get the article out',gen_random_uuid(),'w-run-1'),
 ('10000000-0000-0000-0000-000000000001','e1460000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000003','مراجع','Get the post out',gen_random_uuid(),'w-run-2'),
 ('10000000-0000-0000-0000-000000000001','e1460000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','Plan the campaign',gen_random_uuid(),'w-run-3');
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
 select company_id,id,'Get the article out','c1460000-0000-0000-0000-000000000002','e1460000-0000-0000-0000-000000000001' from public.work_stages
 where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind='before_review' order by position,id limit 1;
select set_config('test.card',(select id::text from public.work_cards where conversation_id='e1460000-0000-0000-0000-000000000001'),true);
select set_config('test.stage',(select stage_id::text from public.work_cards where id=current_setting('test.card')::bigint),true);
insert into auth.users(id,email) values ('90000000-0000-0000-0000-000000000146','outsider@example.test');
insert into public.people(id,name) values ('90000000-0000-0000-0000-000000000146','Outsider');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000146','contributor');
-- The Card's wait as each reader reads it with the Card, and as a forged row names it.
create temporary table reads(who text, wait jsonb);
grant all on reads to authenticated;
create function pg_temp.read_wait(who text, person uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',person::text,true);
 insert into reads select who,(select public.card_wait(w) from public.work_cards w where w.id=current_setting('test.card')::bigint);
 insert into reads select who||' forged',public.card_wait(jsonb_populate_record(null::public.work_cards,
  jsonb_build_object('id',current_setting('test.card')::bigint,'company_id','10000000-0000-0000-0000-000000000001')));
end $$;
grant execute on function pg_temp.read_wait(text,uuid) to authenticated;

set local role authenticated;
select pg_temp.read_wait('person','20000000-0000-0000-0000-000000000003');
reset role;
select is((select wait from reads where who='person'),null,'a Card whose chat asks nothing waits on nobody');
delete from reads;

-- A step handed over in each chat, and a draft and a review shown in the tied one, a draft in the other.
select set_config('test.hand','{"app":"WordPress","line":"The draft is ready; you press Publish.","rows":[]}',true);
set local role service_role;
select results_eq($$select public.agent_show_card(x.conversation,x.run,x.call,x.kind,x.title,x.content::jsonb)->>'state' from (values
  (1,'e1460000-0000-0000-0000-000000000001'::uuid,'w-run-1','call-0','hand','انشر المقال',current_setting('test.hand')),
  (2,'e1460000-0000-0000-0000-000000000002'::uuid,'w-run-2','call-0','hand','انشر البوست',current_setting('test.hand')),
  (3,'e1460000-0000-0000-0000-000000000001'::uuid,'w-run-1','call-1','draft','خطة الحملة','{"line":"مسودة","rows":[]}'),
  (4,'e1460000-0000-0000-0000-000000000002'::uuid,'w-run-2','call-1','draft','خطة البوست','{"line":"مسودة","rows":[]}'),
  (5,'e1460000-0000-0000-0000-000000000001'::uuid,'w-run-1','call-2','review','مراجعة النصوص','{"line":"نصين","items":[{"text":"أ","fine":true,"note":"تمام"},{"text":"ب","fine":false,"note":"عدّل"}],"decision":"واحد جاهز"}')
 ) x(n,conversation,run,call,kind,title,content) order by x.n$$,
 $$select 'shown' from generate_series(1,5)$$,'each card is shown');
reset role;
select set_config('test.hand_t',(select id::text from public.reply_cards where conversation_id='e1460000-0000-0000-0000-000000000001' and kind='hand'),true);
select set_config('test.hand_u',(select id::text from public.reply_cards where conversation_id='e1460000-0000-0000-0000-000000000002' and kind='hand'),true);

set local role authenticated;
select pg_temp.read_wait('person','20000000-0000-0000-0000-000000000003');
select pg_temp.read_wait('another Contributor','20000000-0000-0000-0000-000000000005');
select pg_temp.read_wait('Viewer','20000000-0000-0000-0000-000000000004');
select pg_temp.read_wait('Manager Ads is hidden from','20000000-0000-0000-0000-000000000002');
select pg_temp.read_wait('outsider','90000000-0000-0000-0000-000000000146');
reset role;
select results_eq($$select who,wait from reads order by who collate "C"$$,
 $$values ('Manager Ads is hidden from'::text,null::jsonb),('Manager Ads is hidden from forged',null),
  ('Viewer','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}'),('Viewer forged','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}'),
  ('another Contributor','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}'),('another Contributor forged','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}'),
  ('outsider',null),('outsider forged',null),
  ('person','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}'),('person forged','{"person":"20000000-0000-0000-0000-000000000003","kind":"hand","title":"انشر المقال"}')$$,
 'the open hand waits on its person, and the person, another Contributor and the Viewer read the same wait with the Card; a Member Ads is hidden from and someone of another Company read none, even naming the Card');
delete from reads;
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000146',true);
select is(public.card_wait(jsonb_populate_record(null::public.work_cards,jsonb_build_object('id',current_setting('test.card')::bigint,'company_id','10000000-0000-0000-0000-000000000002'))),null,
 'nor does naming the Card under their own Company');

-- The one rule: true for the person and for a Member who sees the Card, false for anyone else, whatever row they forge.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select ok(public.reply_card_waits(jsonb_populate_record(null::public.reply_cards,jsonb_build_object('id',current_setting('test.hand_t')::bigint))),'the hand waits, for its person');
select ok(public.reply_card_waits(jsonb_populate_record(null::public.reply_cards,jsonb_build_object('id',current_setting('test.hand_u')::bigint,'state','closed'))),
 'judged on the stored card, not the row it is given');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select results_eq($$select public.reply_card_waits(jsonb_populate_record(null::public.reply_cards,jsonb_build_object('id',x))) from unnest(array[current_setting('test.hand_t'),current_setting('test.hand_u')]::bigint[]) x$$,
 $$values (true),(false)$$,'another Contributor learns the wait of the chat whose Card they see, and nothing of the chat with no Card');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(not public.reply_card_waits(jsonb_populate_record(null::public.reply_cards,jsonb_build_object('id',current_setting('test.hand_t')::bigint))),'a Member Ads is hidden from learns nothing');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000146',true);
select ok(not public.reply_card_waits(jsonb_populate_record(null::public.reply_cards,jsonb_build_object('id',current_setting('test.hand_t')::bigint))),'nor does someone of another Company');

-- The person's own list names the chat's Card on its hand; the hand of the chat with no Card names none.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select kind,id,card_id,conversation_id from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind in ('hand','question') order by id$$,
 $$values ('hand'::text,current_setting('test.hand_t')::bigint,current_setting('test.card')::bigint,'e1460000-0000-0000-0000-000000000001'::uuid),
  ('hand',current_setting('test.hand_u')::bigint,null::bigint,'e1460000-0000-0000-0000-000000000002'::uuid)$$,
 'each hand waits in its person''s list, the tied chat''s naming its Card');
reset role;

-- A newer question in the tied chat is its wait while it waits; once answered, the hand is again.
set local role service_role;
select is(public.track_run_question('e1460000-0000-0000-0000-000000000001','w-run-3','{"id":"p1@1","text":"Which audience first?","choices":["Parents","Students"],"multiple":false}',false,now()+interval '1 minute'),
 '[]'::jsonb,'the next run asks its question');
reset role;
select set_config('test.question',(select id::text from public.reply_cards where conversation_id='e1460000-0000-0000-0000-000000000001' and kind='question'),true);
set local role authenticated;
select pg_temp.read_wait('asking','20000000-0000-0000-0000-000000000005');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.answer_question('10000000-0000-0000-0000-000000000001','e1460000-0000-0000-0000-000000000001',current_setting('test.question')::bigint,1,null,'c1460000-0000-0000-0000-00000000000a'),'claimed','the person answers it');
select pg_temp.read_wait('answered','20000000-0000-0000-0000-000000000005');
reset role;
select results_eq($$select who,wait->>'kind',wait->>'title' from reads where who in ('asking','answered') order by who desc$$,
 $$values ('asking'::text,'question'::text,'Which audience first?'::text),('answered','hand','انشر المقال')$$,
 'the newest waiting item of the chat is its Card''s wait: the open question, then the hand once it is answered');
delete from reads;
set local role service_role;
select is(public.settle_question(current_setting('test.question')::bigint,'answered'),'answered','the Engine took the answer');
reset role;

-- A hand waits only while its person may write and sees its Agent.
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.read_wait('person a Viewer','20000000-0000-0000-0000-000000000005');
reset role;
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000003' and agent_id='c1460000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.read_wait('Ads hidden from the person','20000000-0000-0000-0000-000000000005');
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','c1460000-0000-0000-0000-000000000002');
select results_eq($$select who,wait from reads where who not like '% forged' order by who collate "C"$$,$$values ('Ads hidden from the person'::text,null::jsonb),('person a Viewer',null)$$,
 'a hand stops waiting while its person is a Viewer or Ads is hidden from them');
delete from reads;

-- Done it in each chat; the Card's wait ends there, and its stage never changed.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001',x.conversation,x.card)->>'first' from (values
  ('e1460000-0000-0000-0000-000000000001'::uuid,current_setting('test.hand_t')::bigint),('e1460000-0000-0000-0000-000000000002'::uuid,current_setting('test.hand_u')::bigint)) x(conversation,card)$$,
 $$values ('true'),('true')$$,'the person presses Done it on each');
select pg_temp.read_wait('done','20000000-0000-0000-0000-000000000005');
reset role;
select is((select wait from reads where who='done'),null,'with nothing left open, the Card waits on nobody');
select is((select stage_id from public.work_cards where id=current_setting('test.card')::bigint),current_setting('test.stage')::bigint,'the Card stayed in its stage throughout');

-- The chat's rows: on its Card in the tied chat, private to its person in the other.
select results_eq($$select action,subject,card_id,details ? 'private',details ? 'teller' from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002' order by action,card_id nulls last,id$$,
 $$values ('agent_card_shown'::text,'card'::text,current_setting('test.card')::bigint,false,false),('agent_card_shown','card',current_setting('test.card')::bigint,false,false),('agent_card_shown','agent',null,true,true),
  ('agent_hand_done','card',current_setting('test.card')::bigint,false,false),('agent_hand_done','agent',null,true,true),
  ('agent_question_answered','card',current_setting('test.card')::bigint,false,false)$$,
 'a draft, a review, an answer and a Done it are written on the chat''s Card, with no teller; with no Card, the draft and the Done it are private to their person');
create temporary table logged(who text, actions text);
grant all on logged to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into logged select 'person',string_agg(action||':'||subject,',' order by action,subject) from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into logged select 'another Contributor',string_agg(action||':'||subject,',' order by action,subject) from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into logged select 'Viewer',string_agg(action||':'||subject,',' order by action,subject) from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into logged select 'Manager Ads is hidden from',coalesce(string_agg(action||':'||subject,',' order by action,subject),'') from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into logged select 'Owner',string_agg(action||':'||subject,',' order by action,subject) from public.company_log where agent_id='c1460000-0000-0000-0000-000000000002';
reset role;
select results_eq($$select who,actions from logged order by who collate "C"$$,
 $$values ('Manager Ads is hidden from'::text,''::text),
  ('Owner','agent_card_shown:agent,agent_card_shown:card,agent_card_shown:card,agent_hand_done:agent,agent_hand_done:card,agent_question_answered:card'),
  ('Viewer','agent_card_shown:card,agent_card_shown:card,agent_hand_done:card,agent_question_answered:card'),
  ('another Contributor','agent_card_shown:card,agent_card_shown:card,agent_hand_done:card,agent_question_answered:card'),
  ('person','agent_card_shown:agent,agent_card_shown:card,agent_card_shown:card,agent_hand_done:agent,agent_hand_done:card,agent_question_answered:card')$$,
 'every Member who sees the Card reads its rows; the private ones only their person and the Owner, who manages; a Member Ads is hidden from reads none');
select throws_ok($$update public.company_log set subject='card',card_id=current_setting('test.card')::bigint,details=details-'private'-'teller' where agent_id='c1460000-0000-0000-0000-000000000002' and card_id is null$$,
 '42501','logIsPermanent','a private row stays where it was written, even for the database');

select * from finish();
rollback;
