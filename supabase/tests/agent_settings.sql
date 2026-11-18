begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
-- #125: a setting changed on an Agent's Engine profile is one row in the Company log, written only by an active Owner.
insert into public.hermes_agents(id,company_id,name,speciality,profile) values
 ('e8000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Settings agent','Writing','co-10000000000000000000000000000001'),
 ('e8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Elsewhere settings agent','Writing','co-10000000000000000000000000000002');
set local role authenticated;

-- The Owner of RS Learning logs a change: the Agent, the setting and both values.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','memory.memory_char_limit','2200'::jsonb,'2600'::jsonb)$$,'the Owner logs a setting change');
select is((select concat_ws('|',subject,action,agent_id::text,details->>'setting',details->>'old',details->>'new') from public.company_log
 where source='hermes_agent_audit' and company_id='10000000-0000-0000-0000-000000000001' order by id desc limit 1),
 'agent|agent_setting_changed|e8000000-0000-0000-0000-000000000001|memory.memory_char_limit|2200|2600','the row names the Agent, the setting and the value before and after');
select is((select concat_ws('|',actor_kind,actor_id::text,details->>'agent_name') from public.company_log
 where source='hermes_agent_audit' and action='agent_setting_changed' order by id desc limit 1),
 'person|20000000-0000-0000-0000-000000000001|Settings agent','and is the signed-in Owner, with the Agent''s name');

-- A Manager, a Contributor and a Viewer write nothing.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','memory.memory_char_limit','2600'::jsonb,'2700'::jsonb)$$,'42501','settingNotAllowed','a Manager writes no setting log row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','memory.memory_char_limit','2600'::jsonb,'2700'::jsonb)$$,'42501','settingNotAllowed','a Contributor writes no setting log row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','memory.memory_char_limit','2600'::jsonb,'2700'::jsonb)$$,'42501','settingNotAllowed','a Viewer writes no setting log row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- An Agent of another Company is not reached, and a bad setting name or a value that looks like a key is refused.
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','memory.memory_char_limit','2200'::jsonb,'2600'::jsonb)$$,'P0002','settingAgentUnknown','an Agent of another Company is never reached');
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','not a setting','1'::jsonb,'2'::jsonb)$$,'22023','settingInvalid','a name that is not the Engine''s key shape is refused');
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','display.personality','"warm"'::jsonb,'"sk-aaaaaaaaaaaaaaaaaaaaaaaa"'::jsonb)$$,'22023','settingSecret','a value that looks like a key is never logged');
select is((select count(*)::int from public.company_log where source='hermes_agent_audit' and action='agent_setting_changed'),1,'only the one good change is in the log');

-- The log writer stays private; the setting logger is the only door a Member has.
reset role;
select ok(not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute'),'the log writer is not callable by a Member');
select * from finish();
rollback;
