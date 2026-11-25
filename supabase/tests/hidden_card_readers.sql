begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
-- #228. RS Learning's Ads Agent is shown to the Manager, the first Contributor (…03, whose chat made the Card) and the
-- Viewer, and hidden from the second Contributor (…05) and from the Writer agent (30…01), which is
-- is assigned the Card. Each function that reads Cards as its owner answers for this Card, to a caller Ads is hidden
-- from, exactly as for a Card that does not exist, and works on it once Ads is shown.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a2280000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c2280000-0000-0000-0000-000000000001','Ads','Runs the Meta ads.',false,'hidden-cards-ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a2280000-0000-0000-0000-000000000001'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e2280000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2280000-0000-0000-0000-000000000001','Ads');
insert into public.work_cards(company_id,status,title,agent_id,conversation_id,description) values
 ('10000000-0000-0000-0000-000000000001','progress','Plan the June campaign','a2280000-0000-0000-0000-000000000001','e2280000-0000-0000-0000-000000000001','- [ ] Hook written');
insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000001','ideas','An untied idea');
select set_config('test.card',(select id::text from public.work_cards where conversation_id='e2280000-0000-0000-0000-000000000001'),true);
select set_config('test.untied',(select id::text from public.work_cards where title='An untied idea'),true);
select set_config('test.missing',(select (max(id)+1000)::text from public.work_cards),true);
-- Written by the second Contributor while Ads was still shown to them.
insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Shorter hook?','20000000-0000-0000-0000-000000000005');
select set_config('test.note',(select id::text from public.work_comments where card_id=current_setting('test.card')::bigint),true);
select set_config('test.missing_note',(select (max(id)+1000)::text from public.work_comments),true);
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
 -- The writes a Member makes on a Card since the cutover (#684); the Agent's own board write is gone.
 ('move',$$public.move_card('10000000-0000-0000-0000-000000000001',%1$s,'ideas')$$),
 ('title',$$public.save_card('10000000-0000-0000-0000-000000000001',%1$s,'title','Renamed',null)$$),
 ('description',$$public.save_card_description('10000000-0000-0000-0000-000000000001',%1$s,'Renamed',0)$$),
 ('assignee',$$public.assign_card('10000000-0000-0000-0000-000000000001',%1$s,null,'30000000-0000-0000-0000-000000000002')$$),
 ('todo',$$public.tick_card_todo('10000000-0000-0000-0000-000000000001',%1$s,1,'Hook written',true)$$),
 ('review',$$public.ask_review('10000000-0000-0000-0000-000000000001',%1$s)$$),
 ('comment',$$public.change_work_card('10000000-0000-0000-0000-000000000001',%1$s,'comment','{"body":"Three ads drafted."}')$$),
 ('version',$$public.change_work_card('10000000-0000-0000-0000-000000000001',%1$s,'version','{"creative":1,"path":"draft.png"}')$$),
 ('creative',$$public.change_work_card('10000000-0000-0000-0000-000000000001',%1$s,'creative','{"name":"Ad one"}')$$);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.ask_review('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint);
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
 $$values ('contributor Ads is hidden from'::text,''::text,1),('contributor who sees Ads','question',0),('manager','approval,question',0),('owner','approval,question',0),('viewer','question',0)$$,
 'moved to review, the Card waits on every Owner and Manager who sees Ads (#681) and on each Member asked about it who sees Ads; the Contributor Ads is hidden from gets none of it, and still has their item on an untied Card');
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
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is_empty($$select op,hidden,missing from (select op,pg_temp.answer(call,'card') as hidden,pg_temp.answer(call,'missing') as missing from writes) w where hidden is distinct from missing$$,
 'every write on the Card (move, title, description, assignee, to-do, review, comment, version, creative) answers as on a missing Card');
reset role;

insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','a2280000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select matches(pg_temp.answer($$public.change_work_card('10000000-0000-0000-0000-000000000001',%1$s,'comment','{"body":"Three ads drafted."}')$$,'card'),'^ok','it writes on the Card');

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
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id='a2280000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.answer(call,'card'),pg_temp.answer(call,'missing'),'and the Card''s review is not theirs to decide, as on a missing Card')
 from (select $$public.decide_review('10000000-0000-0000-0000-000000000001',%s,null,'approve',null)$$ as call) x;
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2280000-0000-0000-0000-000000000001');
set local role authenticated;
select matches(pg_temp.answer(call,'card'),'^ok','and approve the Card')
 from (select $$public.decide_review('10000000-0000-0000-0000-000000000001',%s,null,'approve',null)$$ as call) x;
reset role;
select * from finish();
rollback;
