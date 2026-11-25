begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- #705: the board's archive list, a page at a time, newest archived first, searched by title as All conversations is,
-- with the board's Agent and Project filters asked in the database. RS Learning's Contributor (…03) and a second
-- Contributor (…05) Ads is hidden from. Five archived Cards a day apart, the newest last: two of Ads, one of a Project,
-- one titled in Arabic with marks and tatweel; and an archived Card of RS Consultations, a Company neither is in.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7050000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c7050000-0000-0000-0000-000000000001','Ads','Runs the Meta ads.',false,'archived-list-ads');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a7050000-0000-0000-0000-000000000001');
insert into public.work_projects(company_id,name) values ('10000000-0000-0000-0000-000000000001','List June');
insert into public.work_cards(company_id,status,title,agent_id,project_id,archived_at,archived_by)
 select '10000000-0000-0000-0000-000000000001','progress',x.title,x.agent::uuid,case when x.project then (select id from public.work_projects where name='List June') end,
  timestamptz '2026-11-01 09:00Z'+x.n*interval '1 day','20000000-0000-0000-0000-000000000003'
 from (values (1,'List weekly report',null,false),(2,'List ads June','a7050000-0000-0000-0000-000000000001',false),(3,'List project brief',null,true),
  (4,'List مُــهمّة أسعار',null,false),(5,'List ads July','a7050000-0000-0000-0000-000000000001',false)) x(n,title,agent,project)
;
insert into public.work_cards(company_id,status,title,archived_at) values ('10000000-0000-0000-0000-000000000002','ideas','List elsewhere',now());
create temporary table ids on commit drop as select title,id,archived_at from public.work_cards where title like 'List %';
grant select on ids to authenticated;
-- The titles of the Cards a call of the list gave, in its order, the fixture's alone.
create function pg_temp.titles(call text) returns text language plpgsql as $$
declare result text;
begin
 execute format('select coalesce(string_agg(x.title,%L order by x.ordinality),%L) from %s with ordinality x where x.title like %L',',','',call,'List %') into result;
 return result;
end $$;
grant execute on function pg_temp.titles(text) to authenticated;
-- The list of RS Learning, with the arguments given.
create function pg_temp.list(args text default '') returns text language sql as $$
 select pg_temp.titles(format('public.archived_card_list(%L%s)','10000000-0000-0000-0000-000000000001',args)) $$;
grant execute on function pg_temp.list(text) to authenticated;

select ok(not has_function_privilege('anon','public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)','execute')
 and not has_function_privilege('anon','public.archived_card_count(uuid)','execute'),'nobody signed out lists or counts archived Cards');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

select is(pg_temp.list(),'List ads July,List مُــهمّة أسعار,List project brief,List ads June,List weekly report','the list is newest archived first');
select is(pg_temp.list(',lim=>2'),'List ads July,List مُــهمّة أسعار','a page holds as many as asked');
select is(pg_temp.list(format(',lim=>2,after_at=>%L,after_id=>%s',(select archived_at from ids where title='List مُــهمّة أسعار'),(select id from ids where title='List مُــهمّة أسعار'))),
 'List project brief,List ads June','the next page starts after the last Card of the one before');
select is(pg_temp.list(format(',after_at=>%L,after_id=>%s',(select archived_at from ids where title='List weekly report'),(select id from ids where title='List weekly report'))),
 '','and the page after the oldest is empty');
-- Two Cards archived in the same moment are told apart by their id, so a page never skips nor repeats one.
reset role;
update public.work_cards set archived_at=(select archived_at from ids where title='List ads June') where id=(select id from ids where title='List project brief');
set local role authenticated;
select is(pg_temp.list(format(',lim=>1,after_at=>%L,after_id=>%s',(select archived_at from ids where title='List ads June'),greatest((select id from ids where title='List ads June'),(select id from ids where title='List project brief')))),
 (select title from ids where title in ('List ads June','List project brief') order by id limit 1),'Cards archived in the same moment page on by their id');
reset role;
update public.work_cards set archived_at=(select archived_at from ids where title='List project brief') where id=(select id from ids where title='List project brief');
set local role authenticated;
select is((select count(*)::int from public.archived_card_list('10000000-0000-0000-0000-000000000001',lim=>500)),
 least(100,(select count(*)::int from public.archived_cards('10000000-0000-0000-0000-000000000001'))),'a page asked too long is held to its most');

select is(pg_temp.list(',q=>''  مهمه اسعار  '''),'List مُــهمّة أسعار','a search reads Arabic as the product''s search does, marks, tatweel and hamza seats aside');
select is(pg_temp.list(',q=>''WEEKLY'''),'List weekly report','a search reads any case');
select is(pg_temp.list(',q=>''ads'',lim=>1'),'List ads July','a search pages as the list does');
select is(pg_temp.list(',q=>''nothing like it'''),'','a search with no match lists nothing');

select is(pg_temp.list(',agent=>''a7050000-0000-0000-0000-000000000001'''),'List ads July,List ads June','the Agent filter keeps that Agent''s Cards');
select is(pg_temp.list(format(',project=>%s',(select id from public.work_projects where name='List June'))),'List project brief','the Project filter keeps that Project''s Cards');
select is((select public.archived_card_count('10000000-0000-0000-0000-000000000001'))-(select count(*)::int from public.archived_cards('10000000-0000-0000-0000-000000000001')),0,
 'the count is every archived Card the reader sees');

-- A Card hidden from a Member stays hidden, and another Company's are never read.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(pg_temp.list(',q=>''list'''),'List مُــهمّة أسعار,List project brief,List weekly report','a Member Ads is hidden from does not see its archived Cards, in the list or a search');
select is(pg_temp.titles(format('public.archived_card_list(%L)','10000000-0000-0000-0000-000000000002'))||public.archived_card_count('10000000-0000-0000-0000-000000000002')::text,'0',
 'someone outside a Company lists and counts none of its archived Cards');
select * from finish();
rollback;
