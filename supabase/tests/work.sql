begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
-- The Work tables: a Company's Cards, their files, Versions, comments and log are its own; a Card's edits, comments and
-- files are logged with their evidence; comments stay their author's; a Card keeps a place inside its column (#174).
-- Since the Card cutover (#684) a Card has a status, no stage, labels or checklist (card_status.sql holds its moves).
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000008','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000099','work-isolated','Test','e3821000-0000-4000-8000-000000000008');
insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000099','ideas','Private');
insert into public.work_creatives(company_id,card_id,name) select company_id,id,'Private' from public.work_cards where company_id='10000000-0000-0000-0000-000000000099';
insert into storage.objects(bucket_id,name) values ('creatives','10000000-0000-0000-0000-000000000099/private.png');
select ok(to_regclass('public.work_stages') is null and to_regclass('public.work_labels') is null,'a new company receives no stages or labels: a Card''s status is its column');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.work_cards where company_id='10000000-0000-0000-0000-000000000099'),0,'cards isolated');
select is((select count(*)::int from public.work_activity where company_id='10000000-0000-0000-0000-000000000099'),0,'activity isolated');
select is((select count(*)::int from public.work_creatives where company_id='10000000-0000-0000-0000-000000000099'),0,'creatives isolated');
select is((select count(*)::int from public.work_versions where company_id='10000000-0000-0000-0000-000000000099'),0,'versions isolated');
select is((select count(*)::int from storage.objects where bucket_id='creatives' and name like '10000000-0000-0000-0000-000000000099/%'),0,'storage select isolated');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('creatives','10000000-0000-0000-0000-000000000099/forbidden.png')$$,'42501',null,'storage insert isolated');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',1,'progress',null,'https://example.test/move')$$,'move with evidence');
select lives_ok($$select public.edit_work_card('10000000-0000-0000-0000-000000000001',1,'{"title":"Evidence title"}','https://example.test/edit')$$,'edit the title');
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'comment','{"body":"Evidence comment"}','https://example.test/comment')$$,'add comment');
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'creative','{"name":"test.png"}')$$,'add creative');
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'version',jsonb_build_object('creative',(select id from public.work_creatives where card_id=1 and name='test.png'),'path','10000000-0000-0000-0000-000000000001/1/test.png'),'https://example.test/version')$$,'add version');
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'creative_with_version','{"name":"تصميم.png","path":"10000000-0000-0000-0000-000000000001/1/opaque"}')$$,'create creative and first version together');
select is((select count(*)::int from public.work_versions v join public.work_creatives c on c.id=v.creative_id where c.name='تصميم.png' and v.path='10000000-0000-0000-0000-000000000001/1/opaque'),1,'first version belongs to the named creative');
select throws_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',1,'creative_with_version','{"name":"invalid.png","path":"wrong/path"}')$$,'23514',null,'invalid first version rejects the whole operation');
select is((select count(*)::int from public.work_creatives where card_id=1 and name='invalid.png'),0,'failed first version leaves no empty creative');
select is((select count(distinct details->>'field')::int from public.work_activity where card_id=1 and actor_id=auth.uid()
 and ((details->>'field'='status' and evidence='https://example.test/move') or (details->>'field'='title' and evidence='https://example.test/edit'))),2,'the move and the edit are logged with their evidence');
select is((select count(*)::int from public.work_activity where card_id=1 and actor_id=auth.uid() and action='comment_added' and evidence='https://example.test/comment'),1,'and the comment with its own');
select is((select body from public.work_comments where card_id=1 and body='Evidence comment'),'Evidence comment','comment body retained');
select is((select author_id from public.work_comments where card_id=1 and body='Evidence comment'),auth.uid(),'comment author recorded');
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
with changed as (update public.work_comments set body='forged',author_id=auth.uid() where card_id=1 and body='Evidence comment' returning 1) select is((select count(*)::int from changed),0,'contributor cannot alter another member comment');
select is((select relrowsecurity from pg_class where oid='public.work_comments'::regclass),true,'comment row security is enabled');
select is((select rolsuper or rolbypassrls from pg_roles where rolname=current_user),false,'current role cannot bypass row security');
select isnt((select tableowner::text from pg_tables where schemaname='public' and tablename='work_comments'),current_user::text,'current role does not own the comment table');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='work_comments' and cmd in ('DELETE','ALL')),0,'no policy permits comment removal');
select is((select author_id from public.work_comments where card_id=1 and body='Evidence comment'),'30000000-0000-0000-0000-000000000001'::uuid,'original author survives attempted forgery');
select is((select details->>'body' from public.work_activity where card_id=1 and action='comment_added' and details->>'body'='Evidence comment'),'Evidence comment','activity keeps the original comment');
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select lives_ok($$update public.work_cards set go_live='2031-11-12 09:15:42.123+00' where id=1$$,'set date with seconds');
select lives_ok($$select public.edit_work_card('10000000-0000-0000-0000-000000000001',1,'{"go_live":"2031-11-12T09:15"}','https://example.test/unchanged')$$,'save unchanged displayed minute');
select is((select go_live from public.work_cards where id=1),'2031-11-12 09:15:42.123+00'::timestamptz,'unchanged minute preserves seconds');
select is((select count(*)::int from public.work_activity where card_id=1 and details->>'field'='go_live' and evidence='https://example.test/unchanged'),0,'unmodified date creates no activity');
select lives_ok($$select public.edit_work_card('10000000-0000-0000-0000-000000000001',1,'{"go_live":"2031-11-12T09:16"}','https://example.test/changed')$$,'change displayed minute');
select is((select count(*)::int from public.work_activity where card_id=1 and details->>'field'='go_live' and evidence='https://example.test/changed'),1,'changed date creates activity');

-- #174: a Card keeps a place inside its column, the same order for everyone, and a change of place is not a move.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into public.work_cards(company_id,status,title) select '10000000-0000-0000-0000-000000000001','planned','Place '||n from generate_series(1,3) n;
create function pg_temp.place(t text) returns bigint language sql stable as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title='Place '||t $$;
grant execute on function pg_temp.place(text) to authenticated;
select is((select array_agg(title order by board_order,id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title like 'Place %'),array['Place 1','Place 2','Place 3'],'a new card goes to the end of its column');
select is((select count(distinct board_order)::int from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title like 'Place %'),3,'cards made together take a place each');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.place('3'),'planned',pg_temp.place('1'))$$,'a card is placed above another in its column');
select is((select array_agg(title order by board_order,id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title like 'Place %'),array['Place 3','Place 1','Place 2'],'the placed card sits above the card it was dropped on');
select is((select count(*)::int from public.work_activity where company_id='10000000-0000-0000-0000-000000000001' and card_id=pg_temp.place('3') and action='card_changed'),0,'a place inside one column writes no log row');
select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.place('1'),'progress');
select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.place('2'),'progress');
-- #174: two Cards can hold the same place (a move copies one); a Card dropped above one of them lands between the two, as
-- the board draws them, place first and then the older Card.
update public.work_cards set board_order=10 where company_id='10000000-0000-0000-0000-000000000001' and title in ('Place 1','Place 2');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.place('3'),'progress',pg_temp.place('2'))$$,'a card is dropped above one of two Cards on one place');
select is((select array_agg(title order by board_order,id) from public.work_cards p where p.company_id='10000000-0000-0000-0000-000000000001' and p.title like 'Place %' and p.status='progress'),array['Place 1','Place 3','Place 2'],'it lands between them, and the column is numbered again');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',999999,'ideas')$$,'P0002','card not found or not permitted','a card that is not there is not placed');
select * from finish();
rollback;
