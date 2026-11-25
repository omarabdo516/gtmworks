begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #680 (spec #668, ADR 0026): the description saves over the version its writer read; a save over a version that moved
-- on is refused with the newer text and the text read, for the app to merge; every version is kept.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000680','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000680','card-writes','Card writes','e3821000-0000-4000-8000-000000000680');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000680','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000680','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000680','20000000-0000-0000-0000-000000000004','viewer');
insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000680','progress','Write brief'),('10000000-0000-0000-0000-000000000680','ideas','Write gone');
update public.work_cards set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000001' where title='Write gone';
create temporary table ids as select substr(title,7) name,id from public.work_cards where company_id='10000000-0000-0000-0000-000000000680';
grant select on ids to authenticated;
create function pg_temp.id(t text) returns bigint language sql as $$ select id from ids where name=t $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.save(body text,base integer) returns jsonb language sql as $$ select public.save_card_description('10000000-0000-0000-0000-000000000680',pg_temp.id('brief'),body,base) $$;
grant execute on function pg_temp.save(text,integer) to authenticated;

select is((select string_agg(version||':'||body,',') from public.work_card_description_versions where card_id=pg_temp.id('brief')),'0:','a new Card''s empty description is its version 0');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.save(E'# Brief\n- [ ] Hook\n- [ ] Caption',0),jsonb_build_object('saved',true,'version',1,'body',E'# Brief\n- [ ] Hook\n- [ ] Caption'),'a Contributor saves over the version read');
select is((select count(*)::int from public.work_activity where card_id=pg_temp.id('brief') and action='description_changed'),1,'one Activity row');
select is(pg_temp.save(E'# Brief\n- [ ] Hook\n- [ ] Caption\nMore',1)->>'version','2','a second save goes on');
select is((select count(*)::int from public.work_activity where card_id=pg_temp.id('brief') and action='description_changed'),1,'and adds no row within ten minutes');
select is(pg_temp.save(E'# Brief\n- [ ] Hook\n- [ ] Caption\nMore',2)->>'version','2','saving the same text changes nothing');

-- A tick moves the description on; a save over the version before it is refused with both texts.
select is(public.tick_card_todo('10000000-0000-0000-0000-000000000680',pg_temp.id('brief'),2,'Hook',true)->>'version','3','a tick is a version too');
select is(pg_temp.save(E'# Brief\n- [ ] Hook\n- [ ] Caption, shorter\nMore',2),jsonb_build_object('saved',false,'version',3,'body',E'# Brief\n- [x] Hook\n- [ ] Caption\nMore','base',E'# Brief\n- [ ] Hook\n- [ ] Caption\nMore'),
 'a save over a version that moved on is refused with the newer text and the text read');
select is((select description from public.work_cards where id=pg_temp.id('brief')),E'# Brief\n- [x] Hook\n- [ ] Caption\nMore','and changes nothing');
select is((select string_agg(version::text,',' order by version) from public.work_card_description_versions where card_id=pg_temp.id('brief')),'0,1,2,3','every version is kept');
select is(pg_temp.save(E'# Brief\n- [x] Hook\n- [ ] Caption, shorter\nMore',3)->>'saved','true','the merged text saves over the newer version');

select throws_ok($$select public.save_card_description('10000000-0000-0000-0000-000000000680',pg_temp.id('gone'),'x',0)$$,'P0002','card not found or not permitted','an archived Card is not written');
select throws_ok($$select pg_temp.save(repeat('x',200001),4)$$,'22023','description too long','a description has a size');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.save('x',4)$$,'42501','not permitted','a Viewer writes nothing');

select * from finish();
rollback;
