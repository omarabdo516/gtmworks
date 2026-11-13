begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- One log for the Company (#11). Seed people: Omar owns every Company; 0004 is a Viewer of RS Learning only; 0005 is a
-- Contributor of RS Learning and Aleem; 30000000-…-0001 is a role Agent (the writer) in RS Learning.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
 ('d1100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','log-writer','ciphertext','connected'),
 ('d1100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://localhost','log-other','ciphertext','connected');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A Card change writes a row: who, what, on which Card, when.
update public.work_cards set title='عنوان من السجل' where id=(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001');
select is((select concat_ws('|',actor_kind,actor_id::text,actor_name,subject,action,details->>'field',details->>'new')
  from public.company_log where source='work_activity' and card_id=(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001') order by id desc limit 1),
 'person|20000000-0000-0000-0000-000000000001|عمر|card|card_changed|title|عنوان من السجل','a Card change writes a log row naming the Member, the Card and the change');
-- A comment on a Card is a note in the log, once, with its text.
insert into public.work_comments(company_id,card_id,body) values('10000000-0000-0000-0000-000000000001',(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'),'ملاحظة للسجل');
select is((select concat_ws('|',actor_id::text,action,body) from public.company_log where source='work_comments' order by id desc limit 1),'20000000-0000-0000-0000-000000000001|note|ملاحظة للسجل','a Card comment is logged as a note with its author and text');
select is((select count(*)::int from public.company_log where body='ملاحظة للسجل'),1,'a comment is logged once, not again as activity');
-- A change made by an Agent is logged as the Agent's.
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
update public.work_cards set hook='خطاف الوكيل' where id=(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001');
select is((select actor_kind from public.company_log where details->>'field'='hook' order by id desc limit 1),'agent','a Card change by an Agent is logged as the Agent''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A Member change writes a row with the Member and what changed.
update public.members set grant_money_figures=true where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
select is((select concat_ws('|',actor_id::text,subject,person_id::text,action,details->>'person_name',details->'changed'->>0) from public.company_log where source='member_audit' order by id desc limit 1),
 '20000000-0000-0000-0000-000000000001|member|20000000-0000-0000-0000-000000000003|member_changed|مراجع|grant_money_figures','a Member change writes a log row naming the Member and the setting');
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
select is((select concat_ws('|',details->>'old_role',details->>'new_role') from public.company_log where source='member_audit' order by id desc limit 1),'contributor|manager','a Role change keeps the Role before and after');

-- An Agent change writes a row with the Agent and its name.
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d1100000-0000-0000-0000-000000000001',agent_name=>'Scribe',speciality=>'Writing')$$,'the Owner adds an Agent');
select is((select concat_ws('|',actor_id::text,subject,action,details->>'agent_name') from public.company_log where source='hermes_agent_audit' and company_id='10000000-0000-0000-0000-000000000001' order by id desc limit 1),
 '20000000-0000-0000-0000-000000000001|agent|agent_added|Scribe','an Agent change writes a log row naming the Agent');
select ok((select agent_id from public.company_log where source='hermes_agent_audit' order by id desc limit 1)=(select id from public.hermes_agents where name='Scribe'),'the row points at the Agent');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000002','attach','d1100000-0000-0000-0000-000000000002',agent_name=>'Elsewhere',speciality=>'Writing')$$,'a change in another Company');
select is((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000002' and details->>'agent_name'='Elsewhere'),1,'the Owner of both reads it');

-- Scope: a Member reads only their own Companies' rows.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000002'),0,'a Viewer of RS Learning reads nothing of R&S Consultations');
select ok((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000001')>=6,'a Viewer reads the log of their own Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select string_agg(distinct company_id::text,',' order by company_id::text) from public.company_log),'10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000003','a Member of two Companies reads the rows of both, RS Learning and Aleem');
select is((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000002'),0,'and none of a Company they are not in');

-- Nothing in the log is ever deleted or rewritten, not even by the Owner.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$delete from public.company_log where company_id='10000000-0000-0000-0000-000000000001'$$,'42501',null,'the Owner cannot delete a log row');
select throws_ok($$update public.company_log set body='rewritten' where source='work_comments'$$,'42501',null,'the Owner cannot rewrite a log row');
select throws_ok($$insert into public.company_log(company_id,actor_kind,subject,action,source,source_id,created_at) values('10000000-0000-0000-0000-000000000001','system','member','forged','member_audit',999999,now())$$,'42501',null,'no Member writes a log row by hand');
reset role;
select throws_ok($$delete from public.company_log$$,'42501','logIsPermanent','even the database owner cannot delete a row');
select throws_ok($$update public.company_log set action='changed'$$,'42501','logIsPermanent','nor rewrite one');
select * from finish();
rollback;
