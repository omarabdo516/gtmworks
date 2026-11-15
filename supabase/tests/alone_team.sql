begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
-- #10: a second active Member turns an alone Company into a team with nothing moved; a team cannot go back to alone
-- while another Member exists, and can once it is the Owner alone again.
-- RS Learning has many Members; RS Consultations has only its Owner, Omar.
update public.companies set work_mode='team' where id='10000000-0000-0000-0000-000000000001';
select throws_ok($$update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000001'$$,'P0001','workModeTeamHasMembers','a team with other Members cannot switch to alone');
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000001'),'team','the refused Company stays a team');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','manager');
select throws_ok($$update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000002'$$,'P0001','workModeTeamHasMembers','two active Members refuse the switch');
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000002' and person_id='20000000-0000-0000-0000-000000000002';
select lives_ok($$update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000002'$$,'with the other Member removed the switch succeeds');
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000002'),'alone','the Company is alone');
-- An unanswered Company may still answer alone while it has a Manager.
insert into public.companies(id,slug,name,work_mode) values ('10000000-0000-0000-0000-000000000092','unanswered','Unanswered',null);
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000001','owner');
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000092'),null,'a Member joining does not answer for an unanswered Company');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000002','manager');
select lives_ok($$update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000092'$$,'an unanswered Company can still answer alone');
-- A Member restored by an Owner turns the alone Company into a team.
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000002' and person_id='20000000-0000-0000-0000-000000000002';
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000002'),'team','a second active Member makes the Company a team');
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000002' and person_id='20000000-0000-0000-0000-000000000002';
update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000002';
-- An invitation accepted through the app's claim turns the alone Company into a team and leaves its work as it was.
insert into public.conversations(id,company_id,person_id,agent_name) values (gen_random_uuid(),'10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Lead');
create temporary table before_counts as select
 (select count(*) from public.conversations where company_id='10000000-0000-0000-0000-000000000002') conversations,
 (select count(*) from public.work_cards where company_id='10000000-0000-0000-0000-000000000002') cards,
 (select jsonb_agg(l order by l.id) from public.company_log l where company_id='10000000-0000-0000-0000-000000000002') log;
insert into auth.users(id,email) values ('a1000000-0000-0000-0000-000000000010','joiner@example.test');
insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000002','Joiner@example.test','contributor');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000010',true);
select lives_ok($$select public.claim_invitations()$$,'the invited person accepts');
reset role;
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000002'),'team','the accepted invitation makes the Company a team');
select ok((select conversations=(select count(*) from public.conversations where company_id='10000000-0000-0000-0000-000000000002')
 and cards=(select count(*) from public.work_cards where company_id='10000000-0000-0000-0000-000000000002')
 and log=(select jsonb_agg(l order by l.id) from public.company_log l where company_id='10000000-0000-0000-0000-000000000002' and l.id<=(select max((r->>'id')::bigint) from jsonb_array_elements(log) r))
 from before_counts),'every Conversation, Card and earlier log row is unchanged');
select * from finish();
rollback;
