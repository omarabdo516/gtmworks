begin;
create extension if not exists pgtap with schema extensions;
select plan(45);
-- Only the Owner connects and disconnects a Company's apps (#30); a Manager, a Contributor and a Viewer are refused.
-- Each connect and disconnect is one row of the Company's log with who did it and the app; a refusal writes none. A
-- sign-in is finished only by the person who started it while they are still the Company's Owner, and nobody writes
-- the sign-ins by hand. Per Agent: the Owner starts a sign-in and records a disconnect only for an Agent of the Company
-- whose profile is its own, the Agent is kept on the sign-in and the log row names it; an Agent that still shares the
-- main profile, another Company's Agent or none at all is refused, as is every other Role and another Company's Owner.
create function pg_temp.app_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('app_connected','app_disconnected');
$$;
grant execute on function pg_temp.app_rows() to authenticated;
create temporary table before_apps as select pg_temp.app_rows() as rows;
grant select on before_apps to authenticated;
-- A sign-in the Manager started while an Owner, as the database keeps it.
insert into public.company_app_sign_ins(company_id,app,flow_id,started_by) values ('10000000-0000-0000-0000-000000000001','notion','flow-manager-0001','20000000-0000-0000-0000-000000000002');
-- RS Learning (1): Lead, its main Agent, on the Company's own profile; Writer moved to its own; Analyst not moved yet.
-- R&S Consultations (2) has its own Lead. The second Contributor (5) owns Aleem (3). Written without the guards: the
-- functions read only which profile is whose.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('3a000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('3a000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000002','Writer','Writes',false,'ag-3a000000000000000000000000000021'),
 ('3a000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000004','Analyst','Reads numbers',false,'co-10000000000000000000000000000001'),
 ('3a000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','3a000000-0000-0000-0000-000000000003','Lead two','General',true,'co-10000000000000000000000000000002');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy()),
 ('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
insert into public.company_profile_keepers(company_id,agent_id) values ('10000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000011');
insert into public.agent_profiles(agent_id,company_id) values ('3a000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001');
update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000003' and person_id='20000000-0000-0000-0000-000000000005';
set local session_replication_role=origin;
create function pg_temp.audit_agents() returns jsonb language sql security definer as $$
 select jsonb_agg(jsonb_build_array(action,app,agent_id) order by created_at,action) from public.company_audit where company_id='10000000-0000-0000-0000-000000000001' and app='canva';
$$;
grant execute on function pg_temp.audit_agents() to authenticated;
set local role authenticated;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-owner-0001')$$,'the Owner starts a sign-in');
select is((select count(*) from public.company_app_sign_ins where flow_id='flow-owner-0001'),1::bigint,'the Owner reads the sign-in');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','Klaviyo; drop','flow-owner-0002')$$,'22023','appsInvalid','an app is named by its catalogue key');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','a b')$$,'22023','appsInvalid','a flow is the Engine''s id');
select throws_ok($$insert into public.company_app_sign_ins(company_id,app,flow_id,started_by) values ('10000000-0000-0000-0000-000000000001','canva','flow-hand-0001','20000000-0000-0000-0000-000000000001')$$,'42501',null,'nobody writes a sign-in by hand');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,app) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','app_connected','canva')$$,'42501',null,'nobody writes a connect by hand');

select is((select jsonb_agg(jsonb_build_array(name,main,own,profile)) from public.company_app_agents('10000000-0000-0000-0000-000000000001')),
 jsonb_build_array(jsonb_build_array('Lead',true,true,'co-10000000000000000000000000000001'),jsonb_build_array('Analyst',false,false,'co-10000000000000000000000000000001'),
  jsonb_build_array('Writer',false,true,'ag-3a000000000000000000000000000021')),
 'the Owner reads every Agent with its profile, the main one first; one not moved yet shares the main profile and is not its own');
select lives_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-writer-0001','3a000000-0000-0000-0000-000000000021')$$,'the Owner starts a sign-in for one Agent');
select is((select agent_id from public.company_app_sign_ins where flow_id='flow-writer-0001'),'3a000000-0000-0000-0000-000000000021'::uuid,'the sign-in keeps its Agent');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-analyst-0001','3a000000-0000-0000-0000-000000000031')$$,'42501','appsAgentNotOwn','an Agent still on the main profile cannot have an app of its own');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-other-0001','3a000000-0000-0000-0000-000000000012')$$,'42501','appsAgentNotOwn','another Company''s Agent is refused');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-none-0001',null)$$,'42501','appsAgentNotOwn','a sign-in for no Agent is refused');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000031')$$,'42501','appsAgentNotOwn','a disconnect for an Agent on the main profile is refused');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000012')$$,'42501','appsAgentNotOwn','a disconnect for another Company''s Agent is refused');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-manager-0002')$$,'42501','appsNotAllowed','a Manager cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Manager cannot disconnect');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-manager-0009','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Manager cannot connect for an Agent');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Manager cannot disconnect for an Agent');
select is((select count(*) from public.company_app_sign_ins),0::bigint,'a Manager reads no sign-in');
select is((select count(*) from public.finish_app_sign_in('klaviyo','flow-owner-0001')),0::bigint,'another person cannot finish the Owner''s sign-in');
select throws_ok($$select * from public.finish_app_sign_in('notion','flow-manager-0001')$$,'42501','appsNotAllowed','a sign-in whose starter is no longer the Owner finishes nothing');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-contrib-0001')$$,'42501','appsNotAllowed','a Contributor cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Contributor cannot disconnect');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-contrib-0009','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Contributor cannot connect for an Agent');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Contributor cannot disconnect for an Agent');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','klaviyo','flow-viewer-0001')$$,'42501','appsNotAllowed','a Viewer cannot connect');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','klaviyo')$$,'42501','appsNotAllowed','a Viewer cannot disconnect');
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-viewer-0009','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Viewer cannot connect for an Agent');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','a Viewer cannot disconnect for an Agent');
select is((select jsonb_agg(name) from public.company_app_agents('10000000-0000-0000-0000-000000000001')),jsonb_build_array('Lead'),'a Viewer reads only the Agents they see');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.start_app_sign_in('10000000-0000-0000-0000-000000000001','canva','flow-elsewhere-0009','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','another Company''s Owner cannot connect for an Agent');
select throws_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000021')$$,'42501','appsNotAllowed','another Company''s Owner cannot disconnect for an Agent');
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
select is((select jsonb_build_array(company_id,slug) from public.finish_app_sign_in('canva','flow-writer-0001')),jsonb_build_array('10000000-0000-0000-0000-000000000001','rs-learning'),'the Owner finishes the sign-in for one Agent');
select lives_ok($$select public.record_app_disconnected('10000000-0000-0000-0000-000000000001','canva','3a000000-0000-0000-0000-000000000021')$$,'the Owner disconnects it for that Agent');
select is(pg_temp.audit_agents(),jsonb_build_array(jsonb_build_array('app_connected','canva','3a000000-0000-0000-0000-000000000021'),jsonb_build_array('app_disconnected','canva','3a000000-0000-0000-0000-000000000021')),
 'each change keeps its Agent');
select is((select jsonb_agg(jsonb_build_array(actor_id,action,details) order by id) from public.company_log
  where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and details->>'app'='canva'),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','app_connected',jsonb_build_object('app','canva','agent_name','Writer')),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','app_disconnected',jsonb_build_object('app','canva','agent_name','Writer'))),
 'the log names who did it, the app and the Agent');
select * from finish();
rollback;
