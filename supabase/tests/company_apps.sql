begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- Only the Owner connects and disconnects a Company's apps (#30); a Manager, a Contributor and a Viewer are refused.
-- Each connect and disconnect is one row of the Company's log with who did it and the app; a refusal writes none. A
-- sign-in is finished only by the person who started it while they are still the Company's Owner, and nobody writes
-- the sign-ins by hand.
create function pg_temp.app_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('app_connected','app_disconnected');
$$;
grant execute on function pg_temp.app_rows() to authenticated;
create temporary table before_apps as select pg_temp.app_rows() as rows;
grant select on before_apps to authenticated;
-- A sign-in the Manager started while an Owner, as the database keeps it.
insert into public.company_app_sign_ins(company_id,app,flow_id,started_by) values ('10000000-0000-0000-0000-000000000001','notion','flow-manager-0001','20000000-0000-0000-0000-000000000002');
set local role authenticated;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-owner-0001')$$,'the Owner starts a sign-in');
select is((select count(*) from public.company_app_sign_ins where flow_id='flow-owner-0001'),1::bigint,'the Owner reads the sign-in');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','Klaviyo; drop','flow-owner-0002')$$,'22023','appsInvalid','an app is named by its catalogue key');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','a b')$$,'22023','appsInvalid','a flow is the Engine''s id');
select throws_ok($$insert into public.company_app_sign_ins(company_id,app,flow_id,started_by) values ('10000000-0000-0000-0000-000000000001','canva','flow-hand-0001','20000000-0000-0000-0000-000000000001')$$,'42501',null,'nobody writes a sign-in by hand');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,app) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','app_connected','canva')$$,'42501',null,'nobody writes a connect by hand');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-manager-0002')$$,'42501','appsNotAllowed','a Manager cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Manager cannot disconnect');
select is((select count(*) from public.company_app_sign_ins),0::bigint,'a Manager reads no sign-in');
select is((select count(*) from public.finish_app_sign_in('klaviyo','flow-owner-0001')),0::bigint,'another person cannot finish the Owner''s sign-in');
select throws_ok($$select * from public.finish_app_sign_in('notion','flow-manager-0001')$$,'42501','appsNotAllowed','a sign-in whose starter is no longer the Owner finishes nothing');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-contrib-0001')$$,'42501','appsNotAllowed','a Contributor cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Contributor cannot disconnect');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-viewer-0001')$$,'42501','appsNotAllowed','a Viewer cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Viewer cannot disconnect');
select is(pg_temp.app_rows(),(select rows from before_apps),'refusals write no log row');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select jsonb_build_array(company_id,slug) from public.finish_app_sign_in('klaviyo','flow-owner-0001')),jsonb_build_array('10000000-0000-0000-0000-000000000001','rs-learning'),'the Owner finishes their sign-in in their Company');
select is((select count(*) from public.finish_app_sign_in('klaviyo','flow-owner-0001')),0::bigint,'a finished sign-in finishes nothing again');
select lives_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'the Owner disconnects');
select is((select jsonb_agg(jsonb_build_array(actor_id,actor_kind,action,details) order by id) from public.company_log
  where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('app_connected','app_disconnected') and created_at>=now()),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','person','app_connected',jsonb_build_object('app','klaviyo')),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','person','app_disconnected',jsonb_build_object('app','klaviyo'))),
 'one log row per connect and disconnect, naming who did it and the app');
select lives_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','notion','flow-owner-0003')$$,'the Owner starts a sign-in in one Company');
select lives_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000002','notion','flow-owner-0004')$$,'and the same app in another');
select is((select jsonb_agg(flow_id) from public.company_app_sign_ins where started_by='20000000-0000-0000-0000-000000000001' and app='notion' and finished_at is null),
 jsonb_build_array('flow-owner-0004'),'an Owner of two Companies keeps one open sign-in per app: the newest');
select is((select count(*) from public.finish_app_sign_in('notion','flow-owner-0003')),0::bigint,'the replaced sign-in finishes nothing');
select * from finish();
rollback;
