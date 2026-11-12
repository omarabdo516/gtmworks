begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- Two companies, one card with one message in each, and three stored files: two in RS Learning's folder, one in Aleem's.
insert into public.work_cards(company_id,stage_id,title) select company_id,id,'Attachments RS' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and position=1;
insert into public.work_cards(company_id,stage_id,title) select company_id,id,'Attachments Aleem' from public.work_stages where company_id='10000000-0000-0000-0000-000000000003' and position=1;
insert into public.work_comments(company_id,card_id,body) select company_id,id,'First message' from public.work_cards where title in ('Attachments RS','Attachments Aleem');
select set_config('test.rs_card',(select id::text from public.work_cards where title='Attachments RS'),true);
select set_config('test.aleem_card',(select id::text from public.work_cards where title='Attachments Aleem'),true);
select set_config('test.rs_files',jsonb_build_array(jsonb_build_object('name','one.png','content_type','image/png','size',10,'path','10000000-0000-0000-0000-000000000001/t/one'),jsonb_build_object('name','two.pdf','content_type','application/pdf','size',20,'path','10000000-0000-0000-0000-000000000001/t/two'))::text,true);
select set_config('test.aleem_files',jsonb_build_array(jsonb_build_object('name','three.png','content_type','image/png','size',30,'path','10000000-0000-0000-0000-000000000003/t/three'))::text,true);
insert into storage.objects(bucket_id,name) values ('creatives','10000000-0000-0000-0000-000000000001/t/one'),('creatives','10000000-0000-0000-0000-000000000001/t/two'),('creatives','10000000-0000-0000-0000-000000000003/t/three');
-- A stored path from another company's folder cannot be recorded under this company, whoever writes it.
select throws_ok($$insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path,created_by) select company_id,card_id,id,'x','image/png',1,'10000000-0000-0000-0000-000000000003/t/three','20000000-0000-0000-0000-000000000002' from public.work_comments where card_id=current_setting('test.rs_card')::bigint$$,'23514',null,'a file path must start with its own company folder');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,current_setting('test.rs_files')::jsonb),2,'a manager attaches two files to the first message');
select is(public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,current_setting('test.rs_files')::jsonb),0,'the same files again are not attached twice');
select is((select count(*)::int from public.work_attachments where card_id=current_setting('test.rs_card')::bigint),2,'the card holds the two files once');
select is((select count(*)::int from public.work_attachments a join public.work_comments m on m.id=a.comment_id and m.card_id=a.card_id where a.card_id=current_setting('test.rs_card')::bigint and m.body='First message'),2,'both files belong to the first message');
select is(public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,current_setting('test.aleem_files')::jsonb),0,'a file stored in another company folder is not attached');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,0,current_setting('test.rs_files')::jsonb)$$,'P0001','card or message not found','a message that is not on the card is refused');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,'[]'::jsonb)$$,'22023','invalid files','no files is refused');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,'{"name":"x"}'::jsonb)$$,'22023','invalid files','a body that is not a list is refused');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,(select jsonb_agg(jsonb_build_object('name','f','content_type','image/png','size',1,'path','10000000-0000-0000-0000-000000000001/t/one')) from generate_series(1,6)))$$,'22023','invalid files','more than five files is refused');
select throws_ok($$insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path) select company_id,card_id,id,'big','image/png',20971521,'10000000-0000-0000-0000-000000000001/t/big' from public.work_comments where card_id=current_setting('test.rs_card')::bigint$$,'23514',null,'a file over 20 MiB is refused');
-- A viewer reads but cannot attach; people write no other way and change nothing afterwards.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.work_attachments where card_id=current_setting('test.rs_card')::bigint),2,'a viewer of the company sees its files');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000001',current_setting('test.rs_card')::bigint,null,current_setting('test.rs_files')::jsonb)$$,'P0001','not permitted','a viewer cannot attach files');
select throws_ok($$delete from public.work_attachments$$,'42501',null,'nobody deletes an attachment');
-- Aleem's file reaches only Aleem's members.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.attach_files('10000000-0000-0000-0000-000000000003',current_setting('test.aleem_card')::bigint,null,current_setting('test.aleem_files')::jsonb),1,'an Aleem contributor attaches a file to the Aleem card');
select is((select count(*)::int from public.work_attachments where company_id='10000000-0000-0000-0000-000000000003'),1,'an Aleem member sees the Aleem file');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.work_attachments where company_id='10000000-0000-0000-0000-000000000003'),0,'a member of another company sees no Aleem file');
select throws_ok($$select public.attach_files('10000000-0000-0000-0000-000000000003',current_setting('test.aleem_card')::bigint,null,current_setting('test.aleem_files')::jsonb)$$,'P0001','not permitted','a member of another company cannot attach to an Aleem card');
-- A run key's token names its card: the database shows it that card's files and no other card's.
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.rs_card')::bigint)::text,true);
select is((select count(*)::int from public.work_attachments where company_id='10000000-0000-0000-0000-000000000001'),2,'a run key sees the files of its own card');
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.aleem_card')::bigint)::text,true);
select is((select count(*)::int from public.work_attachments where company_id='10000000-0000-0000-0000-000000000001'),0,'a run key sees no file of another card');
select * from finish();
rollback;
