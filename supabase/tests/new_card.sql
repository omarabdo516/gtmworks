begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- #683 (spec #668): one New card form, from the toolbar (Planned) or the Ideas column (at its top), with a description, an
-- assignee or nobody and a Project; made once per request key.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000683','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000683','new-card','New card','e3821000-0000-4000-8000-000000000683');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000683','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000683','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000683','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6830000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000683','f6830000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6830000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000683','f6830000-0000-0000-0000-000000000002','SEO','SEO',false,'default');
insert into public.work_projects(company_id,name) values ('10000000-0000-0000-0000-000000000683','Launch');
insert into public.work_cards(company_id,status,title,board_order) values ('10000000-0000-0000-0000-000000000683','ideas','Old idea',5);
create temporary view made as select w.title,w.status,w.description,w.assignee_agent::text agent,w.assignee_person::text person,w.project_id::text project,w.board_order,w.description_version
 from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000683';
grant select on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select isnt(public.new_card('10000000-0000-0000-0000-000000000683','  Spring post ','planned',E'- [ ] Hook','a6830000-0000-0000-0000-000000000001',null,(select id from public.work_projects where name='Launch'),'f6830000-0000-4000-8000-000000000001'),null,'a Contributor makes a Card');
select is((select row(status,description,agent,project is not null,description_version)::text from made where title='Spring post'),'(planned,"- [ ] Hook",a6830000-0000-0000-0000-000000000001,t,0)','in Planned, with its description, its assignee and its Project');
select is((select count(*)::int from public.work_card_description_versions v join public.work_cards w on w.id=v.card_id where w.title='Spring post'),1,'its description is version 0, kept');
select is(public.new_card('10000000-0000-0000-0000-000000000683','Spring post','planned','',null,null,null,'f6830000-0000-4000-8000-000000000001'),(select id from public.work_cards where title='Spring post'),'the same request key makes no second Card');
select is((select count(*)::int from made where title='Spring post'),1,'one Card');
select lives_ok($$select public.new_card('10000000-0000-0000-0000-000000000683','Fresh idea','ideas','',null,'20000000-0000-0000-0000-000000000003',null,null)$$,'an idea from the Ideas column, assigned to its writer');
select ok((select board_order from made where title='Fresh idea')<(select board_order from made where title='Old idea'),'lands at the top of Ideas');
select is((select action from public.work_activity a join public.work_cards w on w.id=a.card_id where w.title='Fresh idea' and a.action in ('idea_added','card_created')),'idea_added','logged as an idea');
select throws_ok($$select public.new_card('10000000-0000-0000-0000-000000000683','  ','planned')$$,'22023','title required','a Card needs a title');
select throws_ok($$select public.new_card('10000000-0000-0000-0000-000000000683','X','done')$$,'22023','unknown column','a new Card is made in Ideas, Planned or In progress');
select throws_ok($$select public.new_card('10000000-0000-0000-0000-000000000683','X','planned','','a6830000-0000-0000-0000-000000000002')$$,'P0002','agent not found','an Agent the Contributor does not see is no assignee');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.new_card('10000000-0000-0000-0000-000000000683','X','planned')$$,'42501','not permitted','a Viewer makes none');

select * from finish();
rollback;
