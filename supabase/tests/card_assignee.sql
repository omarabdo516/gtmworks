begin;
create extension if not exists pgtap with schema extensions;
select plan(53);
-- #677 (spec #668, ADR 0026): a Card has at most one assignee, an Agent the person sees or a Member who is not a Viewer.
-- Until the cutover (#684) the previous release's shapes stay written beside it: the Agent (agent_id), the next actor
-- and the assignees list. Removing the Agent or the Member leaves the Card assigned to nobody, in its column, logged.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000677','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000677','card-assignee','Card assignee','e3821000-0000-4000-8000-000000000677');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000004','viewer'),
 ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000005','contributor');
-- Ads is shown to the Contributor (…03), SEO to nobody but the Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6770000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000677','f6770000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6770000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000677','f6770000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a6770000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000677','f6770000-0000-0000-0000-000000000003','SEO','SEO',false,'default');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000003','a6770000-0000-0000-0000-000000000002');
-- The previous release makes Cards with an Agent, with a next actor, or with nobody.
insert into public.work_cards(company_id,status,title,agent_id,next_actor) values
 ('10000000-0000-0000-0000-000000000677','progress','Asg Agent','a6770000-0000-0000-0000-000000000002',null),
 ('10000000-0000-0000-0000-000000000677','planned','Asg Actor',null,'20000000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000677','ideas','Asg Nobody',null,null),
 ('10000000-0000-0000-0000-000000000677','ideas','Asg Viewer actor',null,'20000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000677','progress','Asg SEO','a6770000-0000-0000-0000-000000000003',null),
 ('10000000-0000-0000-0000-000000000677','planned','Asg Mine','a6770000-0000-0000-0000-000000000003',null),
 ('10000000-0000-0000-0000-000000000677','progress','Asg Gone','a6770000-0000-0000-0000-000000000002',null),
 ('10000000-0000-0000-0000-000000000677','planned','Asg Leaves',null,null);
create temporary view card as select w.title,w.status,w.assignee_agent::text agent,w.assignee_person::text person,w.agent_id::text old_agent,w.next_actor::text next_actor
 from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000677';
grant select on card to authenticated;
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000677' and title='Asg '||t $$;
grant execute on function pg_temp.id(text) to authenticated;

-- The seed's Cards took their assignee from the old shapes: the next actor, or for the Card in review the person whose
-- work is reviewed.
select is((select string_agg(coalesce(w.assignee_person::text,'-'),',' order by w.id) from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000001'),
 '30000000-0000-0000-0000-000000000001,30000000-0000-0000-0000-000000000002,30000000-0000-0000-0000-000000000003,30000000-0000-0000-0000-000000000004,30000000-0000-0000-0000-000000000001',
 'every seed Card is assigned to its next actor, and the Card in review to the one who sent it there');
select is((select count(*)::int from public.work_cards where num_nonnulls(assignee_agent,assignee_person)>1),0,'no Card has two assignees');
select throws_ok($$update public.work_cards set assignee_person='20000000-0000-0000-0000-000000000003',assignee_agent='a6770000-0000-0000-0000-000000000002' where id=pg_temp.id('Nobody')$$,'23514',null,'a Card has at most one assignee');

-- A Card the previous release makes with an Agent is assigned to that Agent; with a next actor, to that Member.
select is((select agent from card where title='Asg Agent'),'a6770000-0000-0000-0000-000000000002','a Card made with an Agent is assigned to it');
select is((select person from card where title='Asg Actor'),'20000000-0000-0000-0000-000000000003','a Card made with a next actor is assigned to that Member');
select is((select coalesce(agent,person,'nobody') from card where title='Asg Nobody'),'nobody','a Card made with neither is assigned to nobody');
select is((select coalesce(person,'nobody') from card where title='Asg Viewer actor'),'nobody','a Viewer named as next actor is no assignee');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

-- Who sees a Card: everyone but those its assignee Agent is hidden from.
select is((select count(*)::int from public.work_cards where title='Asg SEO'),0,'a Card whose assignee Agent is hidden from the Contributor stays hidden from them');
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000677') b where b.title='Asg SEO'),0,'and off their board');
select is((select count(*)::int from public.work_cards where title='Asg Agent'),1,'a Card whose Agent they see is seen');

-- The previous release writes the next actor; the assignee follows.
update public.work_cards set next_actor='20000000-0000-0000-0000-000000000005' where id=pg_temp.id('Nobody');
select is((select person from card where title='Asg Nobody'),'20000000-0000-0000-0000-000000000005','the previous release''s next actor written moves the assignee to that Member');
-- The previous release adds an assignee to a Card nobody has; that Member becomes its assignee.
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Leaves'),'assignee','{"person":"20000000-0000-0000-0000-000000000003"}')$$,'the previous release adds an assignee');
select is((select person from card where title='Asg Leaves'),'20000000-0000-0000-0000-000000000003','the first assignee the previous release adds to a Card nobody has becomes its assignee');

-- This release assigns with assign_card, and writes the old shapes beside it.
select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Actor'),'a6770000-0000-0000-0000-000000000002',null)$$,'a Contributor assigns a Card to an Agent they see');
select is((select agent||' '||coalesce(person,'-')||' '||old_agent||' '||coalesce(next_actor,'-') from card where title='Asg Actor'),
 'a6770000-0000-0000-0000-000000000002 - a6770000-0000-0000-0000-000000000002 -','the Agent is the assignee, and the previous release reads it as the Card''s Agent with no next actor');
select is((select status from card where title='Asg Actor'),'planned','the Card stays in its column');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('Actor') and a.action='card_changed' and a.details->>'field'='assignee'
 and a.details->>'old'='p:20000000-0000-0000-0000-000000000003' and a.details->>'new'='a:a6770000-0000-0000-0000-000000000002' and a.details->>'new_name'='Ads'),1,'the change has one log row naming both assignees');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('Actor') and a.details->>'field'='next_actor'),0,'and no second row for the next actor it also wrote');
select is((select count(*)::int from public.company_log l where l.card_id=pg_temp.id('Actor') and l.action='card_changed' and l.details->>'field'='assignee'),1,'the row reaches the Company''s log');

select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),null,'20000000-0000-0000-0000-000000000005')$$,'a Contributor assigns a Card to another Member');
select is((select coalesce(agent,'-')||' '||person||' '||coalesce(old_agent,'-')||' '||next_actor from card where title='Asg Agent'),
 '- 20000000-0000-0000-0000-000000000005 - 20000000-0000-0000-0000-000000000005','the Member is the assignee and the previous release''s next actor, and the Card has no Agent');
select lives_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),'assignee','{"person":"20000000-0000-0000-0000-000000000005"}')$$,'the previous release still adds that Member to its assignees list');
select is((select person from card where title='Asg Agent'),'20000000-0000-0000-0000-000000000005','which leaves the assignee as it was');

-- Assign to me.
select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),null,'20000000-0000-0000-0000-000000000003')$$,'Assign to me');
select is((select person from card where title='Asg Agent'),'20000000-0000-0000-0000-000000000003','the Card is the Contributor''s');
-- Assigning an Agent starts nothing yet.
select is((select count(*)::int from public.note_runs where company_id='10000000-0000-0000-0000-000000000677'),0,'assigning an Agent starts no Run');
select is((select count(*)::int from public.conversations where company_id='10000000-0000-0000-0000-000000000677'),0,'nor a Conversation');

select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),'a6770000-0000-0000-0000-000000000003',null)$$,'P0002',null,'an Agent hidden from the person cannot be picked');
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),null,'20000000-0000-0000-0000-000000000004')$$,'22023',null,'a Viewer cannot be the assignee');
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),null,'20000000-0000-0000-0000-000000000099')$$,'22023',null,'nor someone outside the Company');
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Agent'),'a6770000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003')$$,'22023',null,'one assignee, not two');
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('SEO'),null,'20000000-0000-0000-0000-000000000003')$$,'P0002',null,'a Card hidden from the person cannot be assigned by them');
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000002',pg_temp.id('Agent'),null,'20000000-0000-0000-0000-000000000003')$$,'42501',null,'nor in a Company they are not in');
select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Gone'),null,null)$$,'a Card can be assigned to nobody');
select is((select coalesce(agent,person,'nobody')||' '||coalesce(old_agent,next_actor,'nobody') from card where title='Asg Gone'),'nobody nobody','in both shapes');
select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Gone'),'a6770000-0000-0000-0000-000000000002',null)$$,'and back to an Agent');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Gone'),null,'20000000-0000-0000-0000-000000000004')$$,'42501',null,'a Viewer assigns nothing');

-- A Card assigned to a Member is always seen by them, even one an Agent hidden from them made.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.assign_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Mine'),null,'20000000-0000-0000-0000-000000000003')$$,'the Owner assigns the SEO Card to the Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.work_cards where title='Asg Mine'),1,'the Contributor sees the Card assigned to them');
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000677') b where b.title='Asg Mine'),1,'on their board too');
select ok(public.can_see_card('10000000-0000-0000-0000-000000000677',pg_temp.id('Mine')),'and its comments and files (can_see_card)');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.work_cards where title='Asg Mine'),1,'a Card assigned to a Member hides from nobody');

-- Removing an Agent leaves its Cards assigned to nobody, in their columns, logged.
reset role;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
delete from public.hermes_agents where id='a6770000-0000-0000-0000-000000000002';
select is((select coalesce(agent,person,'nobody')||' '||status from card where title='Asg Gone'),'nobody progress','a Card whose Agent is removed is assigned to nobody and stays in its column');
select is((select coalesce(old_agent,'nobody') from card where title='Asg Gone'),'nobody','the previous release reads no Agent either');
select is((select kept_agent_id::text from public.work_cards where id=pg_temp.id('Gone')),'a6770000-0000-0000-0000-000000000002','and the Card keeps the face of the Agent it was made with (#702)');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('Gone') and a.details->>'field'='assignee' and a.details->>'reason'='agent_removed'
 and a.details->>'old'='a:a6770000-0000-0000-0000-000000000002' and a.details->>'old_name'='Ads' and a.details->'new'='null'::jsonb),1,'and the log says the Agent was removed');
select is((select count(*)::int from public.company_log l where l.card_id=pg_temp.id('Gone') and l.details->>'reason'='agent_removed'),1,'in the Company''s log');

-- Removing a Member does the same.
select lives_ok($$select public.remove_member('10000000-0000-0000-0000-000000000677','20000000-0000-0000-0000-000000000003')$$,'the Owner removes the Contributor');
select is((select string_agg(title||':'||coalesce(person,'nobody')||':'||status,',' order by title) from card where title in ('Asg Agent','Asg Mine','Asg Leaves')),
 'Asg Agent:nobody:progress,Asg Leaves:nobody:planned,Asg Mine:nobody:planned','their Cards are assigned to nobody and stay in their columns');
select is((select string_agg(coalesce(next_actor,'nobody'),',' order by title) from card where title in ('Asg Agent','Asg Mine')),'nobody,nobody','the previous release reads no next actor');
select is((select count(*)::int from public.work_activity a where a.card_id in (pg_temp.id('Agent'),pg_temp.id('Mine'),pg_temp.id('Leaves')) and a.details->>'field'='assignee' and a.details->>'reason'='member_removed'
 and a.details->>'old'='p:20000000-0000-0000-0000-000000000003'),3,'each with a log row saying the Member left');

-- A Member made a Viewer is no assignee either.
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000677' and person_id='20000000-0000-0000-0000-000000000005';
select is((select coalesce(person,'nobody') from card where title='Asg Nobody'),'nobody','a Member made a Viewer is no longer the assignee');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('Nobody') and a.details->>'reason'='member_viewer'),1,'logged');

select * from finish();
rollback;
