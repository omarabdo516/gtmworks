begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #188. RS Learning's Agents: Lead (main), Ads (shown to the Contributor) and Hidden (shown to nobody but an Owner);
-- Aleem has an Agent of its own. The seed's Roles are the same as the board's.
insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) values
 ('a1880000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Lead','General','idea-lead',true),
 ('a1880000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Ads','Meta ads','idea-ads',false),
 ('a1880000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Hidden','Search','idea-hidden',false),
 ('a1880000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','Lead','General','idea-aleem',true);
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1880000-0000-0000-0000-000000000002');
set local role authenticated;

-- The Owner adds an idea with the Agent hidden from everyone else.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Owner idea','a1880000-0000-0000-0000-000000000003'::uuid)$$,'the Owner adds an idea with any of the Company Agents');
select is((select agent_id from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title='Owner idea'),'a1880000-0000-0000-0000-000000000003'::uuid,'the chosen Agent is on the Card');
select is((select s.kind from public.work_cards c join public.work_stages s on s.company_id=c.company_id and s.id=c.stage_id where c.title='Owner idea'),'ideas','the idea lands in Ideas');
select is((select count(*)::int from public.work_activity where card_id=(select id from public.work_cards where title='Owner idea') and action='idea_added'),1,'the Card log says an idea was added');
select is((select count(*)::int from public.company_log where card_id=(select id from public.work_cards where title='Owner idea') and action='idea_added'),1,'the Company log copies that line');

-- The previous app version's signature still makes a Card, with no Agent.
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Old signature idea')$$,'the previous signature still makes a Card');
select is((select agent_id from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title='Old signature idea'),null::uuid,'that Card carries no Agent');

-- A Manager and a Contributor add ideas; the Contributor only with an Agent they see, the main Agent included.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Manager idea','a1880000-0000-0000-0000-000000000001'::uuid)$$,'a Manager adds an idea with the main Agent, shown to everyone');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Contributor idea','a1880000-0000-0000-0000-000000000002'::uuid)$$,'a Contributor adds an idea with an Agent shown to them');
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Contributor main idea','a1880000-0000-0000-0000-000000000001'::uuid)$$,'a Contributor adds an idea with the main Agent');
select throws_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Hidden idea','a1880000-0000-0000-0000-000000000003'::uuid)$$,null,'agent not found','an Agent hidden from the person is refused');
select throws_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Other company idea','a1880000-0000-0000-0000-000000000004'::uuid)$$,null,'agent not found','another Company''s Agent is refused');
select throws_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='review'),'Wrong stage idea','a1880000-0000-0000-0000-000000000001'::uuid)$$,null,'no Ideas stage','an idea cannot be put in another stage');
select throws_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'   ','a1880000-0000-0000-0000-000000000001'::uuid)$$,'22023','invalid idea','an empty idea is refused');

-- The newest idea sits at the top of Ideas (#174's order): above every Card already in the column.
select ok((select board_order from public.work_cards where title='Contributor main idea')<(select min(w.board_order) from public.work_cards w join public.work_stages t on t.company_id=w.company_id and t.id=w.stage_id where w.company_id='10000000-0000-0000-0000-000000000001' and t.board_column='ideas' and w.title<>'Contributor main idea'),'a new idea goes to the top of Ideas');

-- #452: the board sends an idea under a request key; Add pressed twice, or a retry, is one Card.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((public.agent_write('10000000-0000-0000-0000-000000000001','idea-1','fp-idea-1','idea',null,jsonb_build_object('stage',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'title','Keyed idea','agent','a1880000-0000-0000-0000-000000000001'))->>'id')::bigint,(select id from public.work_cards where title='Keyed idea'),'a keyed idea answers with its new Card');
select is((public.agent_write('10000000-0000-0000-0000-000000000001','idea-1','fp-idea-1','idea',null,jsonb_build_object('stage',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'title','Keyed idea','agent','a1880000-0000-0000-0000-000000000001'))->>'id')::bigint,(select id from public.work_cards where title='Keyed idea'),'the same key again answers with the same Card');
select is((select count(*)::int from public.work_cards where title='Keyed idea'),1,'the same key makes one Card');
select is((select agent_id from public.work_cards where title='Keyed idea'),'a1880000-0000-0000-0000-000000000001'::uuid,'the keyed idea carries its Agent');
select throws_ok($$select public.agent_write('10000000-0000-0000-0000-000000000001','idea-1','fp-idea-2','idea',null,jsonb_build_object('stage',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'title','Edited keyed idea','agent','a1880000-0000-0000-0000-000000000001'))$$,null,'idempotency key reused','the same key with another idea is refused');

-- A Viewer adds nothing.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'Viewer idea','a1880000-0000-0000-0000-000000000001'::uuid)$$,'P0001','not permitted','a Viewer cannot add an idea');
select is((select count(*)::int from public.work_cards where title='Viewer idea'),0,'the refused idea makes no Card');
select * from finish();
rollback;
