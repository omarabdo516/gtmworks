begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #27, #344: the Company knowledge's text is the Engine's shared Skill company-knowledge, so the database keeps no copy
-- of it and no Run is pinned with it. An Owner and a Manager pass the check of a save, every other Member and a Member
-- of another Company are refused, and each edit is one row of the Company's log naming the part.
select hasnt_table('public','company_knowledge','the knowledge table is gone');
select hasnt_function('public','pin_run_knowledge',array['uuid','uuid'],'no Run is pinned with the knowledge');
select hasnt_function('public','channel_run_knowledge',array['bigint'],'nor a channel Run');
select hasnt_function('public','note_run_knowledge',array['bigint'],'nor a note Run');
select hasnt_function('public','pin_channel_run_knowledge','nor is a channel or note Run row given it as it is made');
select hasnt_function('public','company_knowledge_now',array['uuid'],'the database reads no knowledge');
select hasnt_function('public','save_company_knowledge',array['uuid','text','text'],'and stores none');
select hasnt_column('public','conversation_run_notes','knowledge','a Run keeps no knowledge');
select hasnt_column('public','channel_runs','knowledge','a channel Run neither');
select hasnt_column('public','note_runs','knowledge','a note Run neither');
create function pg_temp.knowledge_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='company_knowledge_changed';
$$;
grant execute on function pg_temp.knowledge_rows() to authenticated;
create temp table before_rows as select pg_temp.knowledge_rows() as n;
grant select on before_rows to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.check_company_knowledge('10000000-0000-0000-0000-000000000001','audience',E'  Accounting graduates, 22 to 30.\n• Cairo\n  '),E'Accounting graduates, 22 to 30.\n• Cairo','the Owner''s text passes, trimmed');
select public.log_company_knowledge('10000000-0000-0000-0000-000000000001','audience',false);
select is(pg_temp.knowledge_rows(),(select n from before_rows)+1,'the edit writes one log row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.check_company_knowledge('10000000-0000-0000-0000-000000000001','audience',E' \n '),'','the Manager clears a part');
select public.log_company_knowledge('10000000-0000-0000-0000-000000000001','audience',true);
select is((select jsonb_build_array(actor_id,actor_kind,actor_name,subject,details) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='company_knowledge_changed' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000002','person','مدير','company',jsonb_build_object('part','audience','cleared',true)),'the row names who cleared which part');
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000001','memory','x')$$,'22023','companyKnowledgeInvalid','an unknown part is refused');
select throws_ok($$select public.log_company_knowledge('10000000-0000-0000-0000-000000000001','memory',false)$$,'22023','companyKnowledgeInvalid','and is never logged');
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000001','products',repeat('a',20001))$$,'22023','companyKnowledgeTooLong','a part over 20,000 characters is refused');
select is(length(public.check_company_knowledge('10000000-0000-0000-0000-000000000001','products',repeat('a',20000)||'  ')),20000,'one of 20,000 characters passes');
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000001','products','Ads account password: hunter22')$$,'22023','companyKnowledgeSecret','text that looks like a secret is refused');
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000003','voice','Manager of RS Learning only')$$,'42501','companyKnowledgeNotAllowed','a Manager of another Company cannot edit it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Contributor text')$$,'42501','companyKnowledgeNotAllowed','a Contributor cannot edit it');
select throws_ok($$select public.log_company_knowledge('10000000-0000-0000-0000-000000000001','audience',false)$$,'42501','companyKnowledgeNotAllowed','nor log an edit');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_company_knowledge('10000000-0000-0000-0000-000000000001','audience','Viewer text')$$,'42501','companyKnowledgeNotAllowed','nor can a Viewer');
select is(pg_temp.knowledge_rows(),(select n from before_rows)+2,'refused saves write no log row');
reset role;
select * from finish();
rollback;
