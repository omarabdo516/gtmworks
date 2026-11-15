begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
-- #27: an Owner and a Manager edit their Company's knowledge, every Member reads it, nobody of another Company sees it,
-- each edit is one row of the Company's log naming the part, and a run is given the text pinned at its first start.
delete from public.company_knowledge;
insert into public.company_knowledge(company_id,part,body) values ('10000000-0000-0000-0000-000000000003','voice','Aleem''s own voice');
create function pg_temp.knowledge_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='company_knowledge_changed';
$$;
grant execute on function pg_temp.knowledge_rows() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience',E'  Accounting graduates, 22 to 30.\n• Cairo, Giza and Alexandria\n  '),true,'the Owner saves a part');
select is((select row(body,edited_by)::text from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001' and part='audience'),
 row(E'Accounting graduates, 22 to 30.\n• Cairo, Giza and Alexandria','20000000-0000-0000-0000-000000000001'::uuid)::text,'the text is stored trimmed, with who edited it');
select is(pg_temp.knowledge_rows(),1::bigint,'the edit writes one log row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Accountants, 22 to 35.'),true,'the Manager edits it');
select is(pg_temp.knowledge_rows(),2::bigint,'and that edit writes one more row');
select is((select jsonb_build_array(actor_id,actor_kind,actor_name,subject,details) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='company_knowledge_changed' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000002','person','مدير','company',jsonb_build_object('part','audience','cleared',false)),'the row names who edited which part');
select is((select edited_by from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001' and part='audience'),'20000000-0000-0000-0000-000000000002'::uuid,'the part names its last editor');
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience',E'\n Accountants, 22 to 35. \n'),false,'the same text again changes nothing');
select is(pg_temp.knowledge_rows(),2::bigint,'and logs nothing');
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','decisions','   '),false,'clearing a part that has no text changes nothing either');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','memory','x')$$,'22023','companyKnowledgeInvalid','an unknown part is refused');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','products',repeat('a',20001))$$,'22023','companyKnowledgeTooLong','a part over 20,000 characters is refused');
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','products',repeat('a',20000)||'  '),true,'one of 20,000 characters is kept');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','products','Ads account password: hunter22')$$,'22023','companyKnowledgeSecret','text that looks like a secret is refused');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000003','voice','Manager of RS Learning only')$$,'42501','companyKnowledgeNotAllowed','a Manager of another Company cannot edit this one');
select is((select count(*) from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000003'),0::bigint,'nor read it');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(part,',' order by part) from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001'),'audience,products','a Contributor reads the knowledge');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Contributor text')$$,'42501','companyKnowledgeNotAllowed','but cannot edit it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select string_agg(part,',' order by part) from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001'),'audience,products','a Viewer reads it');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Viewer text')$$,'42501','companyKnowledgeNotAllowed','but cannot edit it');
select throws_ok($$insert into public.company_knowledge(company_id,part,body) values ('10000000-0000-0000-0000-000000000001','banned','Direct')$$,'42501',null,'nobody writes the table directly');
select is(pg_temp.knowledge_rows(),3::bigint,'refused saves write no log row');
reset role;
-- A Member of Aleem only.
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*) from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001'),0::bigint,'a Member of another Company reads none of it');
select is((select string_agg(body,',') from public.company_knowledge),'Aleem''s own voice','only their own Company''s');
select throws_ok($$select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Not mine')$$,'42501','companyKnowledgeNotAllowed','and cannot edit it');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.save_company_knowledge('10000000-0000-0000-0000-000000000001','audience',E' \n '),true,'the Manager clears a part');
select is((select row(body,edited_by)::text from public.company_knowledge where company_id='10000000-0000-0000-0000-000000000001' and part='audience'),
 row('','20000000-0000-0000-0000-000000000002'::uuid)::text,'it is kept empty, with who cleared it');
select is((select details from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='company_knowledge_changed' order by id desc limit 1),
 jsonb_build_object('part','audience','cleared',true),'the log says it was cleared');
select public.save_company_knowledge('10000000-0000-0000-0000-000000000001',x.part,x.body) from (values ('banned','No guaranteed jobs.'),('voice','Like a colleague two years ahead.'),('products','Tax diploma: 1,800 EGP')) x(part,body);
reset role;

-- A run is pinned with the parts that have text, in the parts' order, at its first start.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','knowledge-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('e5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('e5000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','e5000000-0000-0000-0000-000000000002','Ads');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,start_attempts)
 select 'e5000000-0000-0000-0000-000000000003',('e6000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002','e5000000-0000-0000-0000-000000000002','Draft the offer email','knowledge-test',case n when 3 then 1 else 0 end from generate_series(1,3) n;
select public.pinned_run_note('e5000000-0000-0000-0000-000000000003',('e6000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002') from generate_series(1,3) n;
set local role service_role;
select is(public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000001'),
 jsonb_build_array(jsonb_build_object('part','voice','body','Like a colleague two years ahead.'),jsonb_build_object('part','products','body','Tax diploma: 1,800 EGP'),jsonb_build_object('part','banned','body','No guaranteed jobs.')),
 'a run is pinned with every part that has text, in order, and no cleared one');
reset role;
update public.conversation_run_reservations set start_attempts=1 where send_key='e6000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.save_company_knowledge('10000000-0000-0000-0000-000000000001','voice','Short sentences, no exclamation marks.');
reset role;
set local role service_role;
select is(public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000001')->0->>'body','Like a colleague two years ahead.','its retry after an edit sends the text it was first given');
select is(public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000002')->0->>'body','Short sentences, no exclamation marks.','the next run gets the new text');
select is(public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000003'),'[]'::jsonb,'a run the previous app version already tried to start is told no knowledge');
select is(public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000009'),'[]'::jsonb,'nor is a run with no note');
reset role;
set local role authenticated;
select throws_ok($$select public.pin_run_knowledge('e5000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000002')$$,'42501',null,'only the worker pins');
reset role;
select * from finish();
rollback;
