begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- Review of spec #340: a skill change in an Agent's Engine profile is the Owner's or a Manager's, checked here before the
-- Engine is written, refused for a text that looks like a secret, and logged once as a row of the Company log naming the
-- Agent and the skill. RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer; Aleem is another Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000071','Mona','Writing',true,'skillwriter'),
 ('e1000000-0000-0000-0000-000000000073','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000073','Sara','Writing',true,'aleemskills');
create function pg_temp.skill_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where action like 'skill_%';
$$;
grant execute on function pg_temp.skill_rows() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_skill_write('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071',E'---\nname: weekly-recap\n---\nWrite it.')$$,'the Owner may write a skill');
select public.log_skill_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','weekly-recap','written');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action like 'skill_%' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-000000000071','skill_written',jsonb_build_object('agent_name','Mona','skill','weekly-recap')),'the write is one log row naming who, the Agent and the skill');
select throws_ok($$select public.check_skill_write('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','Ads account password: hunter22')$$,'22023','skillSecret','a text that looks like a secret is refused');
select throws_ok($$select public.check_skill_write('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000073','x')$$,'42501','skillNotAllowed','an Agent of another Company is refused');
select throws_ok($$select public.log_skill_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','Bad Name','written')$$,'22023','skillInvalid','a name the Engine would refuse is never logged');
select throws_ok($$select public.log_skill_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','weekly-recap','deleted')$$,'22023','skillInvalid','nor a change of another kind');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.log_skill_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','weekly-recap','disabled');
select is((select action from public.company_log where action like 'skill_%' order by id desc limit 1),'skill_disabled','a Manager switches a skill off, logged');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_skill_write('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','x')$$,'42501','skillNotAllowed','a Contributor may not');
select throws_ok($$select public.log_skill_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','weekly-recap','enabled')$$,'42501','skillNotAllowed','nor log a change');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_skill_write('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000071','x')$$,'42501','skillNotAllowed','nor a Viewer');
select is(pg_temp.skill_rows(),2::bigint,'refused changes write no log row');
reset role;
select ok(not has_function_privilege('anon','public.check_skill_write(uuid,uuid,text)','execute'),'no signed-out caller reaches the check');
select hasnt_function('public','record_conversation_run',array['uuid','text','text','text','text','bigint','bigint'],'no Member records a Run''s end or session');
select hasnt_function('public','record_conversation_reply',array['uuid','text','text','text'],'nor a reply and its session');
select * from finish();
rollback;
