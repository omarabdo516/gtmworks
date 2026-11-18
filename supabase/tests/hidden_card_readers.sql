begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- #228. RS Learning's Ads Agent is shown to the Manager, the first Contributor (…03, whose chat made the Card) and the
-- Viewer, and hidden from the second Contributor (…05) and from the Writer agent (30…01), which is
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
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is_empty($$select op,hidden,missing from (select op,pg_temp.answer(call,'card') as hidden,pg_temp.answer(call,'missing') as missing from writes) w where hidden is distinct from missing$$,
 'every write on the Card (move, edit, actor, assignee, label, check, comment, version, creative) answers as on a missing Card');
reset role;

insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','a2280000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select matches(pg_temp.answer(call,'card'),'^ok \{"id": \d+\}$','it writes on the Card') from writes where op='comment';
reset role;
-- A lesson learned on the Card, as an Agent's run left one before the external-agent API was removed (#341).
insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint)
 select company_id,id,current_setting('test.card')::bigint,'30000000-0000-0000-0000-000000000001','Open with the number.','Saved more often.',1,'lesson-1','f'
 from public.skills where company_id='10000000-0000-0000-0000-000000000001' and slug='hidden-hooks';
set local role authenticated;

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
