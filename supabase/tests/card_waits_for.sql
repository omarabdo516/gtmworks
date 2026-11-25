begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #682 (spec #668, ADR 0026): a Card waits for other Cards; each side shows the other; a loop is refused in the
-- database; Live, Done or archived releases a wait, and a Card restored makes nobody wait again; a Card waited for that
-- the reader may not see shows only as a hidden Card.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000682','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000682','card-waits','Card waits','e3821000-0000-4000-8000-000000000682');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000682','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000682','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000682','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6820000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000682','f6820000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6820000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000682','f6820000-0000-0000-0000-000000000002','SEO','SEO',false,'default');
insert into public.work_cards(company_id,status,title,assignee_agent) values
 ('10000000-0000-0000-0000-000000000682','planned','Wait post',null),
 ('10000000-0000-0000-0000-000000000682','progress','Wait design',null),
 ('10000000-0000-0000-0000-000000000682','progress','Wait copy',null),
 ('10000000-0000-0000-0000-000000000682','progress','Wait research','a6820000-0000-0000-0000-000000000002');
-- The ids are kept apart, so an archived Card is still named once the reader's own read leaves it out.
create temporary table ids as select substr(title,6) name, id from public.work_cards where company_id='10000000-0000-0000-0000-000000000682';
grant select on ids to authenticated;
create function pg_temp.id(t text) returns bigint language sql as $$ select id from ids where name=t $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.wait(a text,b text) returns void language sql as $$ select public.add_card_wait('10000000-0000-0000-0000-000000000682',pg_temp.id(a),pg_temp.id(b)) $$;
grant execute on function pg_temp.wait(text,text) to authenticated;
create function pg_temp.open() returns text language sql as $$
 select coalesce(string_agg(x.title||':'||o.waiting,',' order by x.title),'') from public.open_card_waits('10000000-0000-0000-0000-000000000682') o join public.work_cards x on x.id=o.card_id $$;
grant execute on function pg_temp.open() to authenticated;
create function pg_temp.links(t text) returns text language sql as $$
 select coalesce(string_agg(side||':'||coalesce(title,'hidden')||':'||coalesce(status,'')||':'||open,',' order by side,other),'') from public.card_wait_links('10000000-0000-0000-0000-000000000682',pg_temp.id(t)) $$;
grant execute on function pg_temp.links(text) to authenticated;

-- The Owner, who sees SEO, sets the waits.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select pg_temp.wait('post','design')$$,'the post waits for the design');
select lives_ok($$select pg_temp.wait('post','copy')$$,'and for the copy');
select lives_ok($$select pg_temp.wait('copy','research')$$,'the copy waits for the research, whose Agent the Contributor does not see');
select lives_ok($$select pg_temp.wait('post','design')$$,'waiting twice for the same Card is one wait');
select is((select count(*)::int from public.work_activity where card_id=pg_temp.id('post') and action='wait_added'),2,'each wait is one row of the log');

-- A loop is refused, directly or through a chain.
select throws_ok($$select pg_temp.wait('design','post')$$,'P0001','wait loop','a Card waited for cannot wait back');
select throws_ok($$select pg_temp.wait('research','post')$$,'P0001','wait loop','nor through a chain');
select throws_ok($$select pg_temp.wait('post','post')$$,'P0001','wait loop','nor wait for itself');
reset role;
select throws_ok($$insert into public.work_card_waits(company_id,card_id,waits_for) values('10000000-0000-0000-0000-000000000682',pg_temp.id('research'),pg_temp.id('copy'))$$,'P0001','wait loop','the database refuses a loop however it is written');
set local role authenticated;

select is(pg_temp.open(),'Wait copy:1,Wait post:2','each Card counts the Cards it still waits for');
select is(pg_temp.links('post'),'waits_for:Wait design:progress:true,waits_for:Wait copy:progress:true','a Card shows what it waits for');
select is(pg_temp.links('design'),'waited_by:Wait post:planned:true','and the Card waited for shows who waits');

-- What the Contributor may not see shows only as a hidden Card.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.links('copy'),'waited_by:Wait post:planned:true,waits_for:hidden::true','a Card waited for that the reader may not see is a hidden Card');
select is(pg_temp.open(),'Wait copy:1,Wait post:2','still counted on the tile');
select is(pg_temp.links('research'),'','a hidden Card''s own waits are not read');
select throws_ok($$select pg_temp.wait('design','research')$$,'P0002','card not found or not permitted','nor waited for by the reader');

-- Released by Live or Done, and for good by archiving.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_card('10000000-0000-0000-0000-000000000682',pg_temp.id('design'),'done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.open(),'Wait copy:1,Wait post:1','a Card waited for that is Done releases its wait');
select is(pg_temp.links('post'),'waits_for:Wait design:done:false,waits_for:Wait copy:progress:true','and shows it released');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.archive_cards('10000000-0000-0000-0000-000000000682',array[pg_temp.id('copy')])$$,'the copy is archived');
select is(pg_temp.open(),'','archived, it waits on nobody and nobody waits on it');
select lives_ok($$select public.restore_cards('10000000-0000-0000-0000-000000000682',array[pg_temp.id('copy')])$$,'restored');
select is(pg_temp.open(),'Wait copy:1','a Card restored makes nobody wait again; its own wait holds');

-- Stop waiting, and who may.
select lives_ok($$select public.remove_card_wait('10000000-0000-0000-0000-000000000682',pg_temp.id('copy'),pg_temp.id('research'))$$,'a wait is removed');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.wait('copy','design')$$,'42501','not permitted','a Viewer sets no wait');

select * from finish();
rollback;
