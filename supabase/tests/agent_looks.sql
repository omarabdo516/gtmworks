begin;
create extension if not exists pgtap with schema extensions;
select plan(51);
-- #696 (spec #694, ADR 0027): every Agent's look (shape, colour, temperament), given in the transaction that makes the
-- Agent and kept by its id. RS Learning (1) has Lead, its main Agent, on the Company's own profile; the Owner (…01) and
-- the Manager (…02) each talk to it. Aleem (3) has its own Lead.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('d6960000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d6960000-0000-0000-0000-0000000000c1','Lead','General',true,'co-10000000000000000000000000000001'),
 ('d6960000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','d6960000-0000-0000-0000-0000000000c3','Lead','General',true,'co-10000000000000000000000000000003');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.company_shared_spaces(company_id,folder) values ('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000001/skills');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c6960000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','d6960000-0000-0000-0000-000000000001','Lead'),
 ('c6960000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','d6960000-0000-0000-0000-000000000001','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','c6960000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want a team for our ads and blog',gen_random_uuid(),'run-1',now()-interval '1 hour'),
 ('10000000-0000-0000-0000-000000000001','c6960000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Mona','I want someone for our numbers',gen_random_uuid(),'rq-1',now()-interval '1 hour');
create temporary table named(name text primary key, agent uuid);
grant all on named to authenticated,service_role;
insert into named values ('lead','d6960000-0000-0000-0000-000000000001'),('aleem','d6960000-0000-0000-0000-000000000003');
create function pg_temp.look(who text) returns text language sql as $$
 select l.shape||' '||l.colour||' '||l.temperament from public.agent_looks l join named n on n.agent=l.agent_id where n.name=who $$;

-- 1. The main Agent: indigo and calm, a circle, every part automatic.
select is(pg_temp.look('lead'),'circle indigo calm','the main Agent is an indigo, calm circle');
select is((select picked_shape is null and picked_colour is null and picked_temperament is null from public.agent_looks where agent_id='d6960000-0000-0000-0000-000000000001'),true,
 'and nothing of it is picked');

-- 2. Lead makes the ready-made roles: each takes its role's temperament and the colour its Company uses least, indigo last.
set local role service_role;
insert into named select 'reach',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-1',agent_name=>'Reach',job=>'Runs the ads.',apps=>'{}',template=>'meta')->>'agent')::uuid;
insert into named select 'hook',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-2',agent_name=>'Hook',job=>'Reviews the ads.',apps=>'{}',template=>'hook')->>'agent')::uuid;
insert into named select 'numbers',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-3',agent_name=>'Numbers',job=>'Reads the numbers.',apps=>'{}',template=>'numbers')->>'agent')::uuid;
insert into named select 'coder',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-4',agent_name=>'Coder',job=>'Codes the site.',apps=>'{}',template=>'coder')->>'agent')::uuid;
-- The previous app version's call, with its old arguments only.
insert into named select 'writer',(public.lead_create_agent('c6960000-0000-0000-0000-000000000001','run-1','call-5','Writer','Writes the blog.','{}','writer',null)->>'agent')::uuid;
reset role;
select results_eq($$select pg_temp.look(w) from unnest(array['reach','hook','numbers','coder','writer']) with ordinality u(w,n) order by n$$,
 $$values ('circle violet energetic'),('circle sky caring'),('circle teal neat'),('circle jade calm'),('circle rose dreamy')$$,
 'ads energetic, the ad reviewer caring, numbers neat, the coder calm and the writer dreamy, each in a colour of its own');

-- 3. Lead gives a temperament: it wins over the role's. One off the list is refused in words Lead can act on.
set local role service_role;
select is(public.lead_agent_temperament('c6960000-0000-0000-0000-000000000001','run-1','call-6','grumpy')->>'state','invalid','a temperament off the list is refused');
select matches(public.lead_agent_temperament('c6960000-0000-0000-0000-000000000001','run-1','call-6','grumpy')->>'reason',
 'calm.*energetic.*warm.*dreamy.*neat.*caring','in words that name every temperament there is');
select is(public.lead_agent_temperament('c6960000-0000-0000-0000-000000000001','run-1','call-6','warm')->>'state','kept','one on the list is kept for the Agent the call makes');
select is(public.lead_agent_temperament('c6960000-0000-0000-0000-000000000001','run-9','call-6','warm')->>'state','refused','not for a run that is not in the Conversation');
insert into named select 'blog',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-6',agent_name=>'Blog',job=>'Writes the blog.',apps=>'{}',template=>'writer')->>'agent')::uuid;
-- 4. Neither Lead nor a role names one: the temperament its Company uses least.
insert into named select 'plain',(public.lead_create_agent(conversation=>'c6960000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-7',agent_name=>'Plain',job=>'Helps.',apps=>'{}')->>'agent')::uuid;
reset role;
select is(pg_temp.look('blog'),'circle dusk warm','the temperament Lead gave, and the next colour nobody has');
select is(pg_temp.look('plain'),'circle slate energetic','with none given, the temperament used least: calm is used twice and every other once, so energetic, first of those');

-- 5. More than eight: once every colour is taken, the least used again, indigo last.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('d6960000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','d6960000-0000-0000-0000-0000000000c9','Ninth','Helps','co-10000000000000000000000000000001');
insert into named values ('ninth','d6960000-0000-0000-0000-000000000009'),('tenth','d6960000-0000-0000-0000-000000000010');
select is((select count(distinct colour)::int from public.agent_looks where company_id='10000000-0000-0000-0000-000000000001'),8,'nine Agents carry all eight colours');
select is((select colour from public.agent_looks where agent_id='d6960000-0000-0000-0000-000000000009'),'violet','the ninth takes the first colour again, and not indigo');

-- 6. Two made at once: making an Agent takes its Company's look lock until its transaction ends, so a second waits and
-- counts the first one's colour.
create temporary view held_look_lock as select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
 and ((classid::bigint<<32)|objid::bigint)=hashtextextended('agent_looks:10000000-0000-0000-0000-000000000002',0)) as held;
select is((select held from held_look_lock),false,'the other Company''s lock is not held before its Agent is made');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('d6960000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','d6960000-0000-0000-0000-0000000000c2','Lead','General',true,'co-10000000000000000000000000000002');
select is((select held from held_look_lock),true,'making it took its Company''s lock, held to the end of the transaction');

-- 7. A request keeps the look it will be made with: its card's face is the made Agent's.
set local role service_role;
select is(public.lead_agent_temperament('c6960000-0000-0000-0000-000000000002','rq-1','call-0','neat')->>'state','kept','the Manager''s Lead gives the requested Agent a temperament');
select is(public.lead_request_agent('c6960000-0000-0000-0000-000000000002','rq-1','call-0','Figures','Reads the numbers.','{}')->>'state','requested','and asks the Owner for it');
reset role;
select set_config('test.request',(select id::text from public.lead_agent_requests where run_id='rq-1'),true);
select is((select colour||' '||temperament from public.agent_looks where request_id=current_setting('test.request')::bigint),'sky neat',
 'the request has its look: the temperament Lead gave and the least used colour');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('d6960000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','d6960000-0000-0000-0000-0000000000ca','Tenth','Helps','co-10000000000000000000000000000001');
select isnt((select colour from public.agent_looks where agent_id='d6960000-0000-0000-0000-000000000010'),'sky','an Agent made while it waits does not take its colour');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_agent_request('10000000-0000-0000-0000-000000000001',current_setting('test.request')::bigint,true),'made','the Owner makes it');
reset role;
insert into named select 'figures',agent_id from public.lead_made_agents where run_id='rq-1';
select is(pg_temp.look('figures'),'circle sky neat','the made Agent has the request''s look');
select is((select count(*)::int from public.agent_looks where request_id=current_setting('test.request')::bigint),1,'one look, the request''s and its Agent''s');

-- 8. Every Member of the Company reads every look, a hidden Agent's included; nobody another Company's; nobody writes one.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_looks where company_id='10000000-0000-0000-0000-000000000001'),
 (select count(*)::int from named where name<>'aleem'),'a Viewer, shown none of the Agents, reads every look of the Company');
select is_empty($$select 1 from public.agent_looks where company_id='10000000-0000-0000-0000-000000000003'$$,'and none of a Company they are not in');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$insert into public.agent_looks(agent_id,company_id,auto_shape,auto_colour,auto_temperament) values (gen_random_uuid(),'10000000-0000-0000-0000-000000000001','circle','rose','calm')$$,
 '42501',null,'an Owner writes no look directly');
select throws_ok($$update public.agent_looks set picked_colour='rose'$$,'42501',null,'nor changes one');
select throws_ok($$delete from public.agent_looks$$,'42501',null,'nor removes one');
reset role;

-- 9. The Owner changes a look, a part at a time, and resets it to automatic; each change is in the log.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'colour','rose')).colour,'rose','the Owner picks a colour');
select lives_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'shape','blob')$$,'and a shape');
select lives_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'temperament','dreamy')$$,'and a temperament');
reset role;
select is(pg_temp.look('reach'),'blob rose dreamy','the Agent has the look picked');
select is((select picked_shape||' '||picked_colour||' '||picked_temperament||' / '||auto_shape||' '||auto_colour||' '||auto_temperament from public.agent_looks l join named n on n.agent=l.agent_id where n.name='reach'),
 'blob rose dreamy / circle violet energetic','and keeps the look it was given beside it');
set local role authenticated;
select is((public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'colour',null)).colour,'violet','reset to automatic gives back the colour it was given');
reset role;
select is((select picked_colour from public.agent_looks l join named n on n.agent=l.agent_id where n.name='reach'),null,'and the colour is automatic again');
select results_eq($$select l.details->>'part',l.details->>'from',l.details->>'to',(l.details->>'automatic')::boolean,l.actor_id from public.company_log l
  join named n on n.agent=l.agent_id where n.name='reach' and l.action='agent_look_changed' order by l.id$$,
 $$values ('colour','violet','rose',false,'20000000-0000-0000-0000-000000000001'::uuid),('shape','circle','blob',false,'20000000-0000-0000-0000-000000000001'),
  ('temperament','energetic','dreamy',false,'20000000-0000-0000-0000-000000000001'),('colour','rose','violet',true,'20000000-0000-0000-0000-000000000001')$$,
 'the Activity log has each change: the part, from, to, whether it went back to automatic, and who');
set local role authenticated;
select lives_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'colour',null)$$,'resetting what is automatic again');
reset role;
select is((select count(*)::int from public.company_log l join named n on n.agent=l.agent_id where n.name='reach' and l.action='agent_look_changed'),4,'changes nothing and logs nothing');
set local role authenticated;
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'colour','orange')$$,'22023','agentLookInvalid','a colour off the list is refused');
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'size','big')$$,'22023','agentLookInvalid','so is a part that is not one');
-- 10. A Manager calling the save directly, a Member of another Company, and an Agent of another Company.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='reach'),'colour','rose')$$,'42501','agentLookNotAllowed','a Manager changes no look');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000003','d6960000-0000-0000-0000-000000000003','colour','rose')$$,'42501','agentLookNotAllowed','nor a Contributor of the other Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001','d6960000-0000-0000-0000-000000000003','colour','rose')$$,'P0002','agentLookNotFound','an Owner names another Company''s Agent with their own Company and changes nothing');
reset role;
select is(pg_temp.look('aleem'),'circle indigo calm','so Aleem''s Lead keeps its look');

-- 11. A move to the Agent's own profile keeps its look.
create temporary table before_move as select l.* from public.agent_looks l join named n on n.agent=l.agent_id where n.name='writer';
set local role service_role;
select ok(public.begin_agent_profile_move((select agent from named where name='writer')),'the Writer begins its move');
select public.record_agent_profile(agent,'ag-'||replace(agent::text,'-',''),false) from named where name='writer';
reset role;
update public.agent_profiles set skills_shared=true where agent_id=(select agent from named where name='writer');
set local role service_role;
select ok(public.move_agent_profile((select agent from named where name='writer')),'and moves to its own profile');
reset role;
select results_eq($$select l.shape,l.colour,l.temperament from public.agent_looks l join named n on n.agent=l.agent_id where n.name='writer'$$,
 $$select shape,colour,temperament from before_move$$,'it keeps its look');

-- 12. Removal: the look stays by the Agent's id, so old records keep its face, and it no longer counts as used.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',(select agent from named where name='hook'))$$,'the Owner removes Hook');
reset role;
select is(pg_temp.look('hook'),'circle sky caring','its look stays');
set local role authenticated;
select throws_ok($$select public.change_agent_look('10000000-0000-0000-0000-000000000001',(select agent from named where name='hook'),'colour','rose')$$,'P0002','agentLookNotFound','and is changed no more');
reset role;

-- 13. A ready-made role's face in the gallery is the face its Agent is made with (#697): a Member of Aleem reads the look
-- each role would take now, and none of another Company.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select results_eq($$select template,shape,colour,temperament from public.ready_made_looks('10000000-0000-0000-0000-000000000003',array['meta','coder'])$$,
 $$values ('meta','circle','violet','energetic'),('coder','circle','violet','calm')$$,'a Member of Aleem sees each role in the colour Aleem uses least and the role''s temperament');
select is_empty($$select 1 from public.ready_made_looks('10000000-0000-0000-0000-000000000001',array['meta'])$$,'and nothing of a Company they are not in');
reset role;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,template) values
 ('d6960000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000003','d6960000-0000-0000-0000-0000000000cd','Reach','Runs the ads','co-10000000000000000000000000000003','meta');
select is((select shape||' '||colour||' '||temperament from public.agent_looks where agent_id='d6960000-0000-0000-0000-000000000013'),'circle violet energetic','the Agent made from it has the face the gallery showed');
set local role authenticated;
select results_eq($$select colour from public.ready_made_looks('10000000-0000-0000-0000-000000000003',array['meta'])$$,$$values ('sky')$$,'and the gallery moves on to the next colour');
reset role;
select * from finish();
rollback;
