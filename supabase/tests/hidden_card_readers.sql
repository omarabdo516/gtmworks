begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
-- #228. RS Learning's Ads Agent is shown to the Manager, the first Contributor (…03, whose chat made the Card) and the
-- Viewer, and hidden from the second Contributor (…05) and from the Writer agent (30…01), which holds a company key and
-- is assigned the Card. Each function that reads Cards as its owner answers for this Card, to a caller Ads is hidden
-- from, exactly as for a Card that does not exist, and works on it once Ads is shown.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
 ('c2280000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/ads','hidden-cards-ads','no-key','unreachable');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a2280000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c2280000-0000-0000-0000-000000000001','Ads','Runs the Meta ads.',false);
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a2280000-0000-0000-0000-000000000001'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e2280000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2280000-0000-0000-0000-000000000001','Ads');
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
 select company_id,id,'Plan the June campaign','a2280000-0000-0000-0000-000000000001','e2280000-0000-0000-0000-000000000001' from public.work_stages
 where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind='before_review' order by position,id limit 1;
insert into public.work_cards(company_id,stage_id,title) select company_id,id,'An untied idea' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas';
select set_config('test.card',(select id::text from public.work_cards where conversation_id='e2280000-0000-0000-0000-000000000001'),true);
select set_config('test.untied',(select id::text from public.work_cards where title='An untied idea'),true);
select set_config('test.missing',(select (max(id)+1000)::text from public.work_cards),true);
insert into public.work_checklist(company_id,card_id,title) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Hook written');
select set_config('test.item',(select id::text from public.work_checklist where card_id=current_setting('test.card')::bigint),true);
-- Written by the second Contributor while Ads was still shown to them.
insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Shorter hook?','20000000-0000-0000-0000-000000000005');
select set_config('test.note',(select id::text from public.work_comments where card_id=current_setting('test.card')::bigint),true);
select set_config('test.missing_note',(select (max(id)+1000)::text from public.work_comments),true);
update public.approval_steps set person_id='20000000-0000-0000-0000-000000000002',role=null where company_id='10000000-0000-0000-0000-000000000001' and removed_at is null;
insert into public.agent_webhooks(company_id,url,secret_encrypted) values ('10000000-0000-0000-0000-000000000001','https://example.test/hook','x') on conflict (company_id) do nothing;
insert into public.agent_keys(id,company_id,person_id,key_hash,kind,card_id,expires_at)
 select ('b2280000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',hash,'run',current_setting('test.card')::bigint,now()+interval '1 hour'
 from (values (1,'hidden-cards-lookup'),(2,'hidden-cards-revoke'),(3,'hidden-cards-revoke-again'),(4,'hidden-cards-propose')) k(n,hash);
-- One call, as text, made on the Card a setting names: what it returned, or its error.
create function pg_temp.answer(call text, card text) returns text language plpgsql as $$
declare result text;
begin
 execute format('select (%s)::text',format(call,current_setting('test.'||card))) into result;
 return 'ok '||coalesce(result,'');
exception when others then return sqlstate||' '||sqlerrm;
end $$;
create temporary table waiting(person text, on_card text, untied int) on commit drop;
create temporary table writes(op text, call text) on commit drop;
grant execute on function pg_temp.answer(text,text) to authenticated,service_role;
grant insert,select on waiting to authenticated;
grant select on writes to authenticated;
insert into writes values
 ('move',$$public.agent_write('10000000-0000-0000-0000-000000000001','move-%1$s','f','move',%1$s,jsonb_build_object('stage',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas')))$$),
 ('edit',$$public.agent_write('10000000-0000-0000-0000-000000000001','edit-%1$s','f','edit',%1$s,'{"fields":{"title":"Renamed"}}')$$),
 ('actor',$$public.agent_write('10000000-0000-0000-0000-000000000001','actor-%1$s','f','actor',%1$s,'{"person":"30000000-0000-0000-0000-000000000001"}')$$),
 ('assignee',$$public.agent_write('10000000-0000-0000-0000-000000000001','assignee-%1$s','f','assignee',%1$s,'{"person":"30000000-0000-0000-0000-000000000002"}')$$),
 ('label',$$public.agent_write('10000000-0000-0000-0000-000000000001','label-%1$s','f','label',%1$s,jsonb_build_object('label',(select min(id) from public.work_labels where company_id='10000000-0000-0000-0000-000000000001')))$$),
 ('check',$$public.agent_write('10000000-0000-0000-0000-000000000001','check-%1$s','f','check',%1$s,jsonb_build_object('item',current_setting('test.item')::bigint,'done',true))$$),
 ('comment',$$public.agent_write('10000000-0000-0000-0000-000000000001','comment-%1$s','f','comment',%1$s,'{"body":"Three ads drafted."}')$$),
 ('version',$$public.agent_write('10000000-0000-0000-0000-000000000001','version-%1$s','f','version',%1$s,'{"creative":1,"path":"draft.png"}')$$),
 ('creative_with_version',$$public.agent_write('10000000-0000-0000-0000-000000000001','creative-%1$s','f','creative_with_version',%1$s,'{"name":"Ad one","path":"ad-one.png"}')$$);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.install_skill('10000000-0000-0000-0000-000000000001','library',E'---\nname: hidden-hooks\ndescription: Write hooks\npermissions: cards.read\n---\nOpen with the reader''s problem.');
select public.set_skill_enabled('10000000-0000-0000-0000-000000000001',(select id from public.skills where company_id='10000000-0000-0000-0000-000000000001' and slug='hidden-hooks'),'30000000-0000-0000-0000-000000000001',true);
select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'waiting');
reset role;
select public.add_waiting_item('10000000-0000-0000-0000-000000000001',p,'question','About the June campaign','',current_setting('test.card')::bigint)
 from unnest(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005']::uuid[]) p;
select public.add_waiting_item('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','question','About the idea','',current_setting('test.untied')::bigint);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into waiting select 'owner',coalesce(string_agg(kind,',' order by kind) filter (where card_id=current_setting('test.card')::bigint),''),count(*) filter (where card_id=current_setting('test.untied')::bigint) from public.waiting_list('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into waiting select 'manager',coalesce(string_agg(kind,',' order by kind) filter (where card_id=current_setting('test.card')::bigint),''),count(*) filter (where card_id=current_setting('test.untied')::bigint) from public.waiting_list('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into waiting select 'contributor who sees Ads',coalesce(string_agg(kind,',' order by kind) filter (where card_id=current_setting('test.card')::bigint),''),count(*) filter (where card_id=current_setting('test.untied')::bigint) from public.waiting_list('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into waiting select 'viewer',coalesce(string_agg(kind,',' order by kind) filter (where card_id=current_setting('test.card')::bigint),''),count(*) filter (where card_id=current_setting('test.untied')::bigint) from public.waiting_list('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into waiting select 'contributor Ads is hidden from',coalesce(string_agg(kind,',' order by kind) filter (where card_id=current_setting('test.card')::bigint),''),count(*) filter (where card_id=current_setting('test.untied')::bigint) from public.waiting_list('10000000-0000-0000-0000-000000000001');
select results_eq($$select person,on_card,untied from waiting order by person$$,
 $$values ('contributor Ads is hidden from'::text,''::text,1),('contributor who sees Ads','question',0),('manager','approval,question',0),('owner','question',0),('viewer','question',0)$$,
 'moved to review, the Card waits on the Manager who holds its step and on each Member asked about it who sees Ads; the Contributor Ads is hidden from gets none of it, and still has their item on an untied Card');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2280000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where card_id=current_setting('test.card')::bigint),0,
 'hidden from the Manager, Ads takes both their approval and their item on the Card out of their list');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2280000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select string_agg(kind,',' order by kind) from public.waiting_list('10000000-0000-0000-0000-000000000001') where card_id=current_setting('test.card')::bigint),'approval,question',
 'shown again, both come back');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.waiting_list(uuid)'::regprocedure),'the list reads as the signed-in Member, under the read rules');

select set_config('request.jwt.claim.sub','',true);
insert into public.work_assignees(company_id,card_id,person_id) values
 ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'30000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001',current_setting('test.untied')::bigint,'30000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.webhook_deliveries where card_id=current_setting('test.card')::bigint and event->>'event_type'='assigned'),0,
 'assigning the Card to the Writer queues no assigned delivery while Ads is hidden from it');
select is((select count(*)::int from public.webhook_deliveries where card_id=current_setting('test.untied')::bigint and event->>'event_type'='assigned'),1,
 'while assigning it an untied Card queues one');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is(pg_temp.answer(call,'card'),pg_temp.answer(call,'missing'),'the Writer asks for a run key for the Card: not found, as a missing Card')
 from (select $$public.issue_run_key('10000000-0000-0000-0000-000000000001',%s,repeat('a',64),60)$$ as call) x;
select is(pg_temp.answer(call,'card'),pg_temp.answer(call,'missing'),'revoking its run keys on the Card ends them and counts none, as on a missing Card')
 from (select $$public.revoke_run_keys('10000000-0000-0000-0000-000000000001',%s,'b2280000-0000-0000-0000-000000000002')$$ as call) x;
select is_empty($$select op,hidden,missing from (select op,pg_temp.answer(call,'card') as hidden,pg_temp.answer(call,'missing') as missing from writes) w where hidden is distinct from missing$$,
 'every write on the Card (move, edit, actor, assignee, label, check, comment, version, creative) answers as on a missing Card');
select set_config('test.propose_key',quote_literal('b2280000-0000-0000-0000-000000000004'),true);
select set_config('test.unknown_key',quote_literal('b2280000-0000-0000-0000-0000000000ff'),true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card')::bigint)::text,true);
select is(pg_temp.answer(call,'propose_key'),pg_temp.answer(call,'unknown_key'),'a lesson from a run on the Card is not permitted, as from a run key whose Card is gone')
 from (select $$public.propose_skill_lesson('10000000-0000-0000-0000-000000000001',%s,'hidden-hooks','lesson-1','f','Open with the number.','Saved more often.')$$ as call) x;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.answer(call,'card'),pg_temp.answer(call,'missing'),'the worker issues the Writer no run key for the Card either')
 from (select $$public.issue_run_key_for('10000000-0000-0000-0000-000000000001',%s,'30000000-0000-0000-0000-000000000001',repeat('b',64),60)$$ as call) x;
select is((select count(*)::int from public.lookup_agent_key('hidden-cards-lookup')),(select count(*)::int from public.lookup_agent_key('no-such-key')),
 'the Writer''s run key on the Card is as unknown as a key whose Card is gone');
select is((select count(*)::int from public.lookup_agent_key('f0358ec2fdc223a1ac2213a6e4b2cec6efe6d175ec823cb2a574e15ecdcf8226')),1,'and its company key works as before');
reset role;
select ok((select revoked_at is not null from public.agent_keys where id='b2280000-0000-0000-0000-000000000002'),'the run key it revoked on the Card has ended');

insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','a2280000-0000-0000-0000-000000000001');
delete from public.work_assignees where card_id=current_setting('test.card')::bigint and person_id='30000000-0000-0000-0000-000000000001';
insert into public.work_assignees(company_id,card_id,person_id) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'30000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.webhook_deliveries where card_id=current_setting('test.card')::bigint and event->>'event_type'='assigned'),1,'assigning it the Card now queues its delivery');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*)::int from public.lookup_agent_key('hidden-cards-lookup')),1,'its run key on the Card works');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select matches(pg_temp.answer(call,'card'),'^ok \d{4}-','it gets a run key for the Card')
 from (select $$public.issue_run_key('10000000-0000-0000-0000-000000000001',%s,repeat('c',64),60)$$ as call) x;
select is(pg_temp.answer(call,'card'),'ok 1','revoking a run key on the Card counts it')
 from (select $$public.revoke_run_keys('10000000-0000-0000-0000-000000000001',%s,'b2280000-0000-0000-0000-000000000003')$$ as call) x;
select matches(pg_temp.answer(call,'card'),'^ok \{"id": \d+\}$','it writes on the Card') from writes where op='comment';
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card')::bigint)::text,true);
select matches(pg_temp.answer(call,'propose_key'),'"status": "pending"','and proposes a lesson from its run on it')
 from (select $$public.propose_skill_lesson('10000000-0000-0000-0000-000000000001',%s,'hidden-hooks','lesson-1','f','Open with the number.','Saved more often.')$$ as call) x;

select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(pg_temp.answer(call,'note'),pg_temp.answer(call,'missing_note'),'hidden from the Contributor, their note on the Card is not found to edit, as a missing note')
 from (select $$public.edit_card_note('10000000-0000-0000-0000-000000000001',%s,'Shorter hook, with the number')$$ as call) x;
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a2280000-0000-0000-0000-000000000001');
set local role authenticated;
select is(pg_temp.answer(call,'note'),'ok true','shown again, they edit it')
 from (select $$public.edit_card_note('10000000-0000-0000-0000-000000000001',%s,'Shorter hook, with the number')$$ as call) x;

reset role;
select set_config('test.lesson',(select id::text from public.skill_lessons where card_id=current_setting('test.card')::bigint),true);
select set_config('test.missing_lesson',(select (max(id)+1000)::text from public.skill_lessons),true);
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id='a2280000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.answer(call,'lesson'),pg_temp.answer(call,'missing_lesson'),'hidden from the Manager, a lesson learned on the Card is not found to decide, as a missing lesson')
 from (select $$public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',%s,false)$$ as call) x;
select is(pg_temp.answer(call,'card'),pg_temp.answer(call,'missing'),'and the Card''s approval is not theirs to decide, as on a missing Card')
 from (select $$public.decide_approval('10000000-0000-0000-0000-000000000001',%s,'approve')$$ as call) x;
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2280000-0000-0000-0000-000000000001');
set local role authenticated;
select is(pg_temp.answer(call,'lesson'),'ok ','shown again, they decide the lesson')
 from (select $$public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',%s,false)$$ as call) x;
select is(pg_temp.answer(call,'card'),'ok ','and approve the Card')
 from (select $$public.decide_approval('10000000-0000-0000-0000-000000000001',%s,'approve')$$ as call) x;
reset role;
select * from finish();
rollback;
