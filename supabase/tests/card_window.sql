begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
-- #678 (spec #668, ADR 0026): the Card window saves each property as it changes. A save states the value it read; when
-- someone changed it meanwhile the database refuses it and answers the newer value, which the window shows. Files go on
-- the Card itself, beside the files on its comments, and comments are read by everyone who sees the Card.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000678','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000678','card-window','Card window','e3821000-0000-4000-8000-000000000678');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000678','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000678','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000678','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6780000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000678','f6780000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6780000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000678','f6780000-0000-0000-0000-000000000002','SEO','SEO',false,'default');
insert into public.work_projects(company_id,name) values ('10000000-0000-0000-0000-000000000678','Window launch');
insert into public.work_cards(company_id,status,title,go_live,assignee_agent) values
 ('10000000-0000-0000-0000-000000000678','planned','Win brief','2026-11-12 09:30+00',null),
 ('10000000-0000-0000-0000-000000000678','progress','Win hidden',null,'a6780000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000678','ideas','Win gone',null,null);
update public.work_cards set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000001' where title='Win gone';
insert into storage.objects(bucket_id,name) values
 ('creatives','10000000-0000-0000-0000-000000000678/'||(select id from public.work_cards where title='Win brief')||'/files/brief.pdf'),
 ('creatives','10000000-0000-0000-0000-000000000678/'||(select id from public.work_cards where title='Win brief')||'/files/logo.png');
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000678' and title='Win '||t $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.save(card text,field text,value text,seen text) returns jsonb language sql as $$
 select public.save_card('10000000-0000-0000-0000-000000000678',pg_temp.id(card),field,value,seen) $$;
grant execute on function pg_temp.save(text,text,text,text) to authenticated;
create function pg_temp.project() returns text language sql as $$ select id::text from public.work_projects where name='Window launch' $$;
grant execute on function pg_temp.project() to authenticated;
create temporary view card as select w.title,to_char(w.go_live at time zone 'UTC','YYYY-MM-DD') go_live,w.project_id::text project,w.assignee_person::text person,w.assignee_agent::text agent
 from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000678';
grant select on card to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

-- The title.
select is(pg_temp.save('brief','title','Win brief, first draft','Win brief'),'{"saved": true, "value": "Win brief, first draft"}'::jsonb,'a title saved over the one it read is saved');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('brief, first draft') and a.action='card_changed' and a.details->>'field'='title'),1,'and logged');
select is(pg_temp.save('brief, first draft','title','Win brief, mine','Win brief'),'{"saved": false, "value": "Win brief, first draft"}'::jsonb,
 'a title saved over an older one is refused, with the newer title');
select is((select count(*)::int from card where title='Win brief, first draft'),1,'and the newer title stays');
select throws_ok($$select pg_temp.save('brief, first draft','title','   ','Win brief, first draft')$$,'22023','title required','a Card keeps a title');

-- The publishing date, read and saved as a day.
select is(pg_temp.save('brief, first draft','go_live','2026-11-20','2026-11-12'),'{"saved": true, "value": "2026-11-20"}'::jsonb,'a publishing date is saved as a day');
select is((select go_live from card where title='Win brief, first draft'),'2026-11-20','the Card is dated that day');
select is(pg_temp.save('brief, first draft','go_live','2026-11-30','2026-11-12'),'{"saved": false, "value": "2026-11-20"}'::jsonb,'a date saved over an older one is refused, with the newer date');
select is(pg_temp.save('brief, first draft','go_live','','2026-11-20'),'{"saved": true, "value": ""}'::jsonb,'the date is cleared');

-- The Project.
select is(pg_temp.save('brief, first draft','project',pg_temp.project(),''),jsonb_build_object('saved',true,'value',pg_temp.project()),'a Project is saved');
select is(pg_temp.save('brief, first draft','project','',''),jsonb_build_object('saved',false,'value',pg_temp.project()),'a Project saved over an older one is refused, with the newer Project');
select throws_ok($$select pg_temp.save('brief, first draft','project','999999999',pg_temp.project())$$,'P0001','project not found','a Project of no one is refused');

-- The assignee, as assign_card decides it (#677).
select is(pg_temp.save('brief, first draft','assignee','p:20000000-0000-0000-0000-000000000003',''),'{"saved": true, "value": "p:20000000-0000-0000-0000-000000000003"}'::jsonb,'"Assign to me" saves');
select is((select person from card where title='Win brief, first draft'),'20000000-0000-0000-0000-000000000003','the Contributor is the assignee');
select is(pg_temp.save('brief, first draft','assignee','a:a6780000-0000-0000-0000-000000000001',''),'{"saved": false, "value": "p:20000000-0000-0000-0000-000000000003"}'::jsonb,
 'an assignee saved over an older one is refused, with the newer assignee');
select throws_ok($$select pg_temp.save('brief, first draft','assignee','a:a6780000-0000-0000-0000-000000000002','p:20000000-0000-0000-0000-000000000003')$$,'P0002','agent not found','an Agent hidden from the Contributor is refused');
select throws_ok($$select pg_temp.save('brief, first draft','assignee','p:20000000-0000-0000-0000-000000000004','p:20000000-0000-0000-0000-000000000003')$$,'22023','assignee not a member','a Viewer is no assignee');
select is(pg_temp.save('brief, first draft','assignee','','p:20000000-0000-0000-0000-000000000003'),'{"saved": true, "value": ""}'::jsonb,'the assignee is cleared');

select throws_ok($$select pg_temp.save('brief, first draft','caption','x','')$$,'22023','unknown field','a field the window does not save is refused');
select throws_ok($$select pg_temp.save('hidden','title','x','Win hidden')$$,'P0002','card not found or not permitted','a Card whose Agent is hidden from the Contributor is not saved');
select throws_ok($$select public.save_card('10000000-0000-0000-0000-000000000678',pg_temp.id('gone'),'title','x','Win gone')$$,'P0002','card not found or not permitted','an archived Card is read-only');
select throws_ok($$select public.save_card('10000000-0000-0000-0000-000000000678',(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'),'title','x','')$$,'P0002','card not found or not permitted','a Card of another Company is not saved under this one');

-- Files on the Card itself.
select is(public.attach_card_files('10000000-0000-0000-0000-000000000678',pg_temp.id('brief, first draft'),jsonb_build_array(
 jsonb_build_object('name','brief.pdf','content_type','application/pdf','size',10,'path','10000000-0000-0000-0000-000000000678/'||pg_temp.id('brief, first draft')||'/files/brief.pdf'),
 jsonb_build_object('name','missing.pdf','content_type','application/pdf','size',10,'path','10000000-0000-0000-0000-000000000678/'||pg_temp.id('brief, first draft')||'/files/missing.pdf'))),1,
 'a Contributor adds a stored file to the Card; one never stored is left out');
select is((select string_agg(a.name||' '||coalesce(a.comment_id::text,'card'),',') from public.work_attachments a where a.company_id='10000000-0000-0000-0000-000000000678'),'brief.pdf card','the file is on the Card, under no comment');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('brief, first draft') and a.action='files_added' and a.details->'names'='["brief.pdf"]'::jsonb),1,'adding it is logged with its name');
select throws_ok($$select public.attach_card_files('10000000-0000-0000-0000-000000000678',pg_temp.id('hidden'),'[{"name":"logo.png","content_type":"image/png","size":10,"path":"10000000-0000-0000-0000-000000000678/1/files/logo.png"}]')$$,
 'P0002','card not found or not permitted','nor to a Card hidden from them');
select throws_ok($$select public.attach_card_files('10000000-0000-0000-0000-000000000678',pg_temp.id('brief, first draft'),'[]')$$,'22023','invalid files','an empty list is refused');

-- Comments are the team's.
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000678',pg_temp.id('brief, first draft'),'comment','{"body":"Shorter please"}')$$,'the Contributor comments');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select string_agg(body,',') from public.work_comments where company_id='10000000-0000-0000-0000-000000000678'),'Shorter please','a Viewer reads the comment');
select is((select count(*)::int from public.work_attachments where company_id='10000000-0000-0000-0000-000000000678'),1,'and the Card''s files');
select throws_ok($$select pg_temp.save('brief, first draft','title','x','Win brief, first draft')$$,'42501','not permitted','a Viewer saves nothing');
select throws_ok($$select public.attach_card_files('10000000-0000-0000-0000-000000000678',pg_temp.id('brief, first draft'),'[{"name":"logo.png","content_type":"image/png","size":10,"path":"x"}]')$$,
 '42501','not permitted','nor adds a file');

select * from finish();
rollback;
