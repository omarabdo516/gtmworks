begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
-- #370: a memory or skill change the Engine holds always gets its one row of the Company log. The check holds it
-- (hold_agent_change), the log writes its row once however often it is retried (finish_agent_change), a refusal drops it
-- (drop_agent_change), and the worker's pass logs a record the app never came back to (finish_held_agent_changes). No row
-- carries a note's text. RS Learning: 1 Owner, 2 Manager, 3 Contributor; Aleem is another Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000a1','Nour','Writing',true,'heldchanges'),
 ('e1000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-0000000000a3','Sara','Writing',true,'aleemheld');
create function pg_temp.rows_for(act text) returns int language sql security definer as $$
 select count(*)::int from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action=act;
$$;
create function pg_temp.held() returns int language sql security definer as $$ select count(*)::int from public.held_agent_changes; $$;
grant execute on function pg_temp.rows_for(text) to authenticated;
grant execute on function pg_temp.held() to authenticated;
create temporary table changes(name text primary key, id uuid);
grant all on changes to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into changes values
 ('reset',public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','memory_reset',null,null,null)),
 ('edit',public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','memory_edit',null,'memory:memory:0:4d2c1b0a9f8e',null)),
 ('forget',public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','memory_forget',null,'memory:profile:1:7a1b2c3d4e5f',null)),
 ('skill',public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','skill_written','weekly-recap',null,E'---\nname: weekly-recap\n---\nWrite it.'));
select is(pg_temp.held(),4,'each allowed change is held before the Engine is asked');
select is(pg_temp.rows_for('memory_reset')+pg_temp.rows_for('memory_edit')+pg_temp.rows_for('memory_forget')+pg_temp.rows_for('skill_written'),0,'and nothing is logged before the Engine holds it');

select ok(public.finish_agent_change((select id from changes where name='reset')),'the reset the Engine holds is logged');
select ok(not public.finish_agent_change((select id from changes where name='reset')),'a retry of that log writes nothing');
select is(pg_temp.rows_for('memory_reset'),1,'so the reset is one row, never two');
select is((select details from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action='memory_reset'),
 jsonb_build_object('agent_name','Nour'),'naming the Agent and nothing of its notes');
select is((select jsonb_build_array(actor_id,actor_kind,subject) from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action='memory_reset'),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent'),'and the person who made it');

-- The Role changed after the change was held: the Engine holds it all the same, so its row is still written.
reset role;
set local session_replication_role=replica;
update public.members set role='manager' where person_id='20000000-0000-0000-0000-000000000001' and company_id='10000000-0000-0000-0000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
select ok(public.finish_agent_change((select id from changes where name='forget')),'a forget the Engine holds is logged though its Owner is no longer one');
select is(pg_temp.rows_for('memory_forget'),1,'one forget row');
reset role;
set local session_replication_role=replica;
update public.members set role='owner' where person_id='20000000-0000-0000-0000-000000000001' and company_id='10000000-0000-0000-0000-000000000001';
set local session_replication_role=origin;
set local role authenticated;

-- Only the person who held it logs or drops it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(not public.finish_agent_change((select id from changes where name='edit')),'another person cannot log a change they did not make');
select lives_ok($$select public.drop_agent_change((select id from changes where name='edit'))$$,'nor drop it');
select is(pg_temp.held(),2,'the edit and the skill are still held');

-- A refusal from the Engine drops the record: nothing is logged, then or by the pass.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.drop_agent_change((select id from changes where name='skill'));
select ok(not public.finish_agent_change((select id from changes where name='skill')),'a dropped change is never logged');
select is(pg_temp.rows_for('skill_written'),0,'so a skill the Engine refused has no row');

-- Refusals hold nothing.
select throws_ok($$select public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a3','memory_reset',null,null,null)$$,'42501','memoryNotAllowed','an Agent of another Company is refused');
select throws_ok($$select public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','memory_edit',null,'weekly-recap',null)$$,'22023','memoryInvalid','an id that is not a memory note''s is refused');
select throws_ok($$select public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','skill_written','weekly-recap',null,'Ads account password: hunter22')$$,'22023','skillSecret','a skill that looks like a secret is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','skill_enabled','weekly-recap',null,null)$$,'42501','skillNotAllowed','a Contributor holds no skill change');

-- The worker's pass: the edit nobody resolved is logged once it is fifteen minutes old, dated when it was held, marked
-- unconfirmed, and once only; a change still in flight is left to its app.
reset role;
update public.held_agent_changes set held_at=timestamptz '2026-11-20 10:00+00';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into changes values ('fresh',public.hold_agent_change('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','memory_reset',null,null,null));
reset role;
select is(public.finish_held_agent_changes(),1,'the pass logs the edit left held, and not the change in flight');
select is((select created_at from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action='memory_edit'),
 timestamptz '2026-11-20 10:00+00','the late row reads when the change was held, not when the pass ran');
select is((select details from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action='memory_edit'),
 jsonb_build_object('agent_name','Nour','unconfirmed',true),'and says nobody confirmed it, with nothing of the note');
select is(public.finish_held_agent_changes(),0,'a second pass finds nothing old enough');
select is(pg_temp.held(),1,'the change in flight is still held');

-- An Agent removed while its change is held is removed all the same, and the change still gets its row.
select ok(not exists(select 1 from pg_constraint where conrelid='public.held_agent_changes'::regclass and confrelid='public.hermes_agents'::regclass),'the hold never stops a removal');
set local session_replication_role=replica;
delete from public.hermes_agents where id='e1000000-0000-0000-0000-0000000000a1';
set local session_replication_role=origin;
update public.held_agent_changes set held_at=now()-interval '16 minutes';
select is(public.finish_held_agent_changes(),1,'the removed Agent''s held reset is logged');
select is(pg_temp.rows_for('memory_reset'),2,'one more reset row, never two');
select is((select details->>'agent_name' from public.company_log where agent_id='e1000000-0000-0000-0000-0000000000a1' and action='memory_reset' order by id desc limit 1),
 'Nour','and it names the Agent as it was when the change was held');
-- A finish or a drop that comes after the pass finds nothing and writes nothing: the change keeps its one row.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select ok(not public.finish_agent_change((select id from changes where name='fresh')),'a finish after the pass writes nothing');
select lives_ok($$select public.drop_agent_change((select id from changes where name='fresh'))$$,'nor does a drop');
reset role;
select is(pg_temp.rows_for('memory_reset'),2,'so the change still has exactly one row');
select * from finish();
rollback;
