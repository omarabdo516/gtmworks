begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- #190. RS Learning with Lead (main), Ads and SEO; Ads is shown to the Contributor (…03), SEO to nobody. A Card of each
-- Agent and one with none; SEO, then Ads, then an old role agent wrote on the Ads Card. Aleem has a Card of its own.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1900000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1900000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a1900000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1900000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a1900000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f1900000-0000-0000-0000-000000000003','SEO','SEO',false,'default');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1900000-0000-0000-0000-000000000002');
insert into public.work_cards(company_id,status,title,agent_id)
 select '10000000-0000-0000-0000-000000000001','ideas',x.title,x.agent::uuid from (values ('Board Lead','a1900000-0000-0000-0000-000000000001'),('Board Ads','a1900000-0000-0000-0000-000000000002'),
  ('Board SEO','a1900000-0000-0000-0000-000000000003'),('Board none',null)) x(title,agent)
;
insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000003','ideas','Board Aleem');
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,body,source,source_id,created_at)
 select '10000000-0000-0000-0000-000000000001',x.actor::uuid,x.kind,x.name,'card',(select id from public.work_cards where title='Board Ads'),x.agent::uuid,'note_reply','Done','note_runs',x.source,now()-x.ago
 from (values ('a1900000-0000-0000-0000-000000000003','agent','SEO','a1900000-0000-0000-0000-000000000003',9190001,interval '3 hours'),
  ('a1900000-0000-0000-0000-000000000002','agent','Ads','a1900000-0000-0000-0000-000000000002',9190002,interval '2 hours'),
  ('a1900000-0000-0000-0000-000000000002','agent','Ads','a1900000-0000-0000-0000-000000000002',9190003,interval '1 hour'),
  ('30000000-0000-0000-0000-000000000001','agent','وكيل المحتوى',null,9190004,interval '30 minutes')) x(actor,kind,name,agent,source,ago);
create function pg_temp.board(c uuid) returns text language sql as $$ select string_agg(title,',' order by title) from public.board_cards(c) where title like 'Board %' $$;
create function pg_temp.crew_names(title text) returns text language sql as $$
 select string_agg(h.name,',' order by n) from public.work_cards w,unnest(public.crew(w)) with ordinality u(agent,n) join public.hermes_agents h on h.id=u.agent where w.title=crew_names.title $$;
grant execute on function pg_temp.board(uuid),pg_temp.crew_names(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.board('10000000-0000-0000-0000-000000000001'),'Board Ads,Board Lead,Board none','the Contributor gets the Cards of Lead, of the Agent shown to them, and with no Agent');
select is((select count(*)::int from public.work_cards where title='Board SEO'),0,'nor does the Card read itself hold the hidden Agent''s Card (#367)');
select is(pg_temp.crew_names('Board Ads'),'Ads','its crew leaves out the hidden Agent and the old role agent');
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000001')),(select count(*)::int from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and (agent_id is null or agent_id<>'a1900000-0000-0000-0000-000000000003')),
 'every other Card of the Company stays on the board');
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000003')),0,'another Company''s board gives a non-Member nothing');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.board('10000000-0000-0000-0000-000000000001'),'Board Ads,Board Lead,Board none,Board SEO','the Owner gets every Card');
select is(pg_temp.crew_names('Board Ads'),'SEO,Ads','and the whole crew, first logged first, each Agent once');
select is(pg_temp.crew_names('Board Lead'),null,'a Card no Company Agent wrote on has no crew');
select is((select public.crew(w) from public.work_cards w where title='Board none'),'{}'::uuid[],'its crew is empty');
select is(pg_temp.board('10000000-0000-0000-0000-000000000003'),'Board Aleem','each Company''s board is its own');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is(pg_temp.board('10000000-0000-0000-0000-000000000001'),'Board Lead,Board none','the Viewer reads the board too, with only the main Agent shown');
select is(pg_temp.crew_names('Board Ads'),null,'and no name in its crew of an Agent hidden from them');
select * from finish();
rollback;
