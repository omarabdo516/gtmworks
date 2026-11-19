begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #29: an Agent's model choice and its sub-agents switch are the Owner's, checked in the database; a member reads them;
-- and the worker's list carries the switch so its profile is written with the policy's delegation variant.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e9000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e9000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','Writer','Writing',false,'co-10000000000000000000000000000001'),
 ('e9000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','e9000000-0000-0000-0000-000000000012','Lead two','General',true,'co-10000000000000000000000000000002');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true),
 ('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy(),true);
-- The Writer gets its own ag- profile, as the worker makes one: the record exists before the Agent names that profile.
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values
 ('e9000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy()),
 ('e9000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002',1,public.engine_tool_policy());
update public.hermes_agents set profile=public.agent_engine_profile(id) where id in ('e9000000-0000-0000-0000-000000000002','e9000000-0000-0000-0000-000000000012');
-- An Agent the worker is moving: its record exists, but the Agent still names the Company's profile, so it is not choosable.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e9000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000013','Mover','Writing',false,'co-10000000000000000000000000000001');
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values
 ('e9000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy());
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- The Owner of RS Learning chooses the Writer's model, and can take the choice away again.
select lives_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000002','openrouter/anthropic/claude-opus-4.6')$$,'the Owner chooses an Agent''s model');
select is((select model_choice from public.company_agent_models('10000000-0000-0000-0000-000000000001') where name='Writer'),'openrouter/anthropic/claude-opus-4.6','the choice is kept with the Agent''s own profile');
select lives_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000002',null)$$,'the Owner makes it follow the Company default again');
select is((select model_choice from public.company_agent_models('10000000-0000-0000-0000-000000000001') where name='Writer'),null,'no choice is kept');
select throws_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000002','not-a-model')$$,'22023','settingInvalid','a value that is not provider/model is refused');
-- The main Agent runs on the Company profile: it has no model of its own, so the choice is refused there.
select throws_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000001','openrouter/openai/gpt-5.5')$$,'42501','settingAgentShared','an Agent on the Company profile holds no choice of its own');
select throws_ok($$select public.set_agent_model('e9000000-0000-0000-0000-0000000000ff','openrouter/openai/gpt-5.5')$$,'P0002','settingAgentUnknown','an Agent that is not this Company''s is never written');

-- The Owner turns sub-agents on for the Writer; the profile is marked as changing before its tools are written.
select lives_ok($$select public.set_agent_subagents('e9000000-0000-0000-0000-000000000002',true)$$,'the Owner turns sub-agents on for one Agent');
reset role;
select is((select concat_ws('|',subagents,tools_pending) from public.agent_profiles where agent_id='e9000000-0000-0000-0000-000000000002'),'t|t','the choice is kept and the profile waits for the new toolset');
set local role authenticated;
-- A member reads each Agent's model choice and whether sub-agents are on, and no other Company's rows.
select is((select concat_ws('|',name,choosable,coalesce(model_choice,'-'),subagents) from public.company_agent_models('10000000-0000-0000-0000-000000000001') where name='Writer'),
 'Writer|t|-|t','a member reads the Writer''s empty choice and its sub-agents state');
select is((select choosable from public.company_agent_models('10000000-0000-0000-0000-000000000001') where name='Lead'),false,'the main Agent on the Company profile has no model field of its own');
select is((select choosable from public.company_agent_models('10000000-0000-0000-0000-000000000001') where name='Mover'),false,'nor an Agent the worker is still moving, whose record exists but still runs on the Company profile');
select is((select count(*)::int from public.company_agent_models('10000000-0000-0000-0000-000000000002')),1,'another Company''s rows name only its own Agents');

-- A Manager, a Contributor and a Viewer choose neither.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000002','openrouter/openai/gpt-5.5')$$,'42501','settingNotAllowed','a Manager chooses no model');
select throws_ok($$select public.set_agent_subagents('e9000000-0000-0000-0000-000000000002',false)$$,'42501','settingNotAllowed','a Manager turns no sub-agents off');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_agent_model('e9000000-0000-0000-0000-000000000002','openrouter/openai/gpt-5.5')$$,'42501','settingNotAllowed','a Contributor chooses no model');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_agent_subagents('e9000000-0000-0000-0000-000000000002',false)$$,'42501','settingNotAllowed','a Viewer turns no sub-agents off');

-- The Owner's choices are logged: the model it chose and the sub-agents switch, in the Company log.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','model',to_jsonb('openrouter/openai/gpt-5.5'::text),to_jsonb('openrouter/anthropic/claude-opus-4.6'::text))$$,'the Owner logs the model it chose');
select lives_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','subagents',to_jsonb(false),to_jsonb(true))$$,'the Owner logs turning sub-agents on');
select is((select string_agg(concat_ws(':',details->>'setting',details->>'old',details->>'new'),',' order by id) from public.company_log
 where source='hermes_agent_audit' and action='agent_setting_changed' and company_id='10000000-0000-0000-0000-000000000001'),
 'model:openrouter/openai/gpt-5.5:openrouter/anthropic/claude-opus-4.6,subagents:false:true','each choice is one log row with its Agent and its values before and after');

reset role;
select is((select subagents from public.agent_profile_work() where agent_id='e9000000-0000-0000-0000-000000000002'),true,'the worker''s list carries the switch, so it writes the delegation variant');
select ok(has_function_privilege('authenticated','public.company_agent_models(uuid)','execute')
 and not has_function_privilege('authenticated','public.agent_profile_work()','execute'),'the rows are read by a member and the worker''s list stays private');
select * from finish();
rollback;
