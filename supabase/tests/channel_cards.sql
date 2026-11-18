begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
-- #148. Ads in RS Learning's general channel, shown to the Manager (2) and Contributor 3; the Owner (1) sees every
-- Agent and Viewer 4 neither. SEO is in the "scripts" team channel only and hidden from everyone outside it, where
-- Contributor 3 calls it and Viewer 4 reads. Karim is a Manager of Aleem only, so he is not in these channels.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('e8148000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e8148000-0000-0000-0000-000000000009','Ads','Ads','channel-cards-test'),
 ('e8148000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e8148000-0000-0000-0000-000000000008','SEO','Articles','channel-cards-seo');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8148000-0000-0000-0000-000000000001'
 from generate_series(2,3) n;
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e8140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','scripts','20000000-0000-0000-0000-000000000003','e8147000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('e8140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003'),
 ('e8140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('e8140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e8148000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');
insert into auth.users(id,email) values ('e8149000-0000-0000-0000-000000000001','karim.cards@example.test');
insert into public.people(id,name) values ('e8149000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e8149000-0000-0000-0000-000000000001','manager');

-- The messages whose Runs carry the cards: the Owner's, the Manager's and the Contributor's in the general channel, a
-- Viewer's there too (never postable, inserted to prove the tools are refused), and the Contributor's in the team
-- channel calling the hidden SEO.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Ads plan the launch','e8141000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000002','مدير','@Ads review the scripts','e8141000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads draft the teaser','e8141000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000004','مشاهد','@Ads write something','e8141000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','e8140000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@SEO review the article','e8141000-0000-0000-0000-000000000005');
select set_config('test.owner',(select id::text from public.channel_messages where send_key='e8141000-0000-0000-0000-000000000001'),true);
select set_config('test.manager',(select id::text from public.channel_messages where send_key='e8141000-0000-0000-0000-000000000002'),true);
select set_config('test.contributor',(select id::text from public.channel_messages where send_key='e8141000-0000-0000-0000-000000000003'),true);
select set_config('test.viewer',(select id::text from public.channel_messages where send_key='e8141000-0000-0000-0000-000000000004'),true);
select set_config('test.team',(select id::text from public.channel_messages where send_key='e8141000-0000-0000-0000-000000000005'),true);
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at,outcome,closed_at)
 select id,company_id,channel_id,case when send_key='e8141000-0000-0000-0000-000000000005' then 'e8148000-0000-0000-0000-000000000002'::uuid else 'e8148000-0000-0000-0000-000000000001'::uuid end,
  case when send_key='e8141000-0000-0000-0000-000000000005' then 'SEO' else 'Ads' end,gen_random_uuid(),body,
  case send_key when 'e8141000-0000-0000-0000-000000000001' then 'run-owner' when 'e8141000-0000-0000-0000-000000000002' then 'run-manager'
   when 'e8141000-0000-0000-0000-000000000003' then 'run-contributor' when 'e8141000-0000-0000-0000-000000000004' then 'run-viewer' else 'run-seo' end,
  'channel-cards-test',1,now(),null,null
 from public.channel_messages where send_key in ('e8141000-0000-0000-0000-000000000001','e8141000-0000-0000-0000-000000000002','e8141000-0000-0000-0000-000000000003','e8141000-0000-0000-0000-000000000004','e8141000-0000-0000-0000-000000000005');
select set_config('test.specs','{"show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}","hand_over":"{\"name\":\"hand_over\"}","create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}"}',true);

-- The tools pinned at the Run's first start: the Owner, the Manager and the Contributor are offered the draft and the
-- review, a Viewer nothing, and a retry keeps the same text.
set local role service_role;
select ok(public.pin_channel_run(current_setting('test.owner')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_draft"%'
 and public.pin_channel_run(current_setting('test.owner')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_review"%','the Owner''s channel Run is offered the draft and the review tools');
select ok(public.pin_channel_run(current_setting('test.manager')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_draft"%'
 and public.pin_channel_run(current_setting('test.manager')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_review"%','the Manager''s too');
select ok(public.pin_channel_run(current_setting('test.contributor')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_draft"%'
 and public.pin_channel_run(current_setting('test.contributor')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_review"%','and the Contributor''s');
select ok(public.pin_channel_run(current_setting('test.team')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_draft"%'
 and public.pin_channel_run(current_setting('test.team')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"show_review"%','a team channel''s hidden Agent is offered the same to the member who may write there');
select is(public.pin_channel_run(current_setting('test.viewer')::bigint,current_setting('test.specs')::jsonb)->>'tools',null,'a Viewer''s channel Run is offered nothing');
select set_config('test.pinned',public.pin_channel_run(current_setting('test.manager')::bigint,current_setting('test.specs')::jsonb)->>'tools',true);
select is(public.pin_channel_run(current_setting('test.manager')::bigint,'{}'::jsonb)->>'tools',current_setting('test.pinned'),'a retry keeps the tools pinned at the first start, whatever it is sent now');
reset role;

-- The cards: a draft and a review under their replies, once per message, run and call; refused to a Viewer, to another
-- run's id and to a kind a channel does not offer; a call that does not hold is invalid and its Run still replies.
select set_config('test.draft','{"line":"مسودة · Meta Ads","rows":[{"label":"Scripts","value":"3"}]}',true);
select set_config('test.review','{"line":"3 نصوص · Meta Ads","items":[{"text":"A","fine":true,"note":"Fine"},{"text":"B","fine":false,"note":"Swap the promise"}],"decision":"1 ready, 1 back"}',true);
set local role service_role;
select is(public.channel_show_card(current_setting('test.owner')::bigint,'run-owner','call-1','draft','خطة ديسمبر',current_setting('test.draft')::jsonb)->>'state','shown','the Owner''s channel Run shows its draft card');
select set_config('test.card',public.channel_show_card(current_setting('test.owner')::bigint,'run-owner','call-1','draft','خطة ديسمبر',current_setting('test.draft')::jsonb)->>'card',true);
select is(public.channel_show_card(current_setting('test.owner')::bigint,'run-owner','call-1','draft','خطة ديسمبر',current_setting('test.draft')::jsonb)->>'card',current_setting('test.card'),'the same message, run and call again answer the same card, as a second closer does');
select is(public.channel_show_card(current_setting('test.manager')::bigint,'run-manager','call-1','review','مراجعة النصوص',current_setting('test.review')::jsonb)->>'state','shown','the Manager''s channel Run shows its review card');
select is(public.channel_show_card(current_setting('test.viewer')::bigint,'run-viewer','call-1','draft','Not offered',current_setting('test.draft')::jsonb)->>'state','refused','a Viewer''s channel Run shows no card');
select is(public.channel_show_card(current_setting('test.owner')::bigint,'another-run','call-2','draft','Elsewhere',current_setting('test.draft')::jsonb)->>'state','refused','a Run id that is not this message''s is refused');
select is(public.channel_show_card(current_setting('test.owner')::bigint,'run-owner','call-2','hand','Publish it','{"app":"WordPress","line":"Ready","rows":[]}'::jsonb)->>'state','refused','a kind a channel does not offer is refused');
select is(public.channel_show_card(current_setting('test.owner')::bigint,'run-owner','call-3','draft',null,current_setting('test.draft')::jsonb)->>'state','invalid','a card that does not hold is invalid');
select is(public.channel_show_card(current_setting('test.team')::bigint,'run-seo','call-1','review','مراجعة المقال',current_setting('test.review')::jsonb)->>'state','shown','a team channel''s hidden Agent shows its card to the member who called it');
select set_config('test.teamcard',public.channel_show_card(current_setting('test.team')::bigint,'run-seo','call-1','review','مراجعة المقال',current_setting('test.review')::jsonb)->>'card',true);
reset role;
select results_eq($$select kind,state,title from public.reply_cards where channel_message_id=current_setting('test.owner')::bigint order by id$$,
 $$values ('draft','shown','خطة ديسمبر')$$,'the draft is kept under the Owner''s reply as the Agent wrote it');
select is((select content from public.reply_cards where channel_message_id=current_setting('test.manager')::bigint and kind='review'),
 current_setting('test.review')::jsonb,'the review keeps its verdicts and its decision');

-- Who reads them: everyone in the channel, a Viewer included, and nobody outside it.
create temporary table seen(who int, general int, team int, team_log int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*)::int from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint)),(select count(*)::int from public.reply_cards where channel_message_id=current_setting('test.team')::bigint),0;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*)::int from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint)),(select count(*)::int from public.reply_cards where channel_message_id=current_setting('test.team')::bigint),(select count(*)::int from public.company_log where source='reply_cards' and source_id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*)::int from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint)),(select count(*)::int from public.reply_cards where channel_message_id=current_setting('test.team')::bigint),(select count(*)::int from public.company_log where source='reply_cards' and source_id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*)::int from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint)),(select count(*)::int from public.reply_cards where channel_message_id=current_setting('test.team')::bigint),(select count(*)::int from public.company_log where source='reply_cards' and source_id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*)::int from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint)),0,0;
select set_config('request.jwt.claim.sub','e8149000-0000-0000-0000-000000000001',true);
insert into seen select 6,(select count(*)::int from public.reply_cards),(select count(*)::int from public.reply_cards),(select count(*)::int from public.company_log where source='reply_cards');
reset role;
select is((select general from seen where who=1),2,'the Owner reads both cards of the general channel they are in');
select is((select team from seen where who=1),0,'and none of a team channel they are not in');
select is((select general from seen where who=2),2,'the Manager reads the general channel''s cards');
select is((select team from seen where who=2),0,'and none of a team channel they are not in');
select is((select general from seen where who=3),2,'the Contributor reads the general channel''s cards');
select is((select team from seen where who=3),1,'and its own team channel''s card, whose Agent is hidden elsewhere');
select is((select general from seen where who=4),2,'the Viewer reads the cards of a channel they are in');
select is((select team from seen where who=4),1,'and its team channel''s card too');
select is((select general from seen where who=5),2,'a Contributor the Agent is hidden from reads the general channel''s cards');
select is((select general from seen where who=6)+(select team from seen where who=6),0,'and a Member of another Company reads nothing');

-- The log rows of #136 and #137 are written for a channel reply and read by the channel's members, also where the Agent
-- is hidden from them elsewhere.
select is((select count(*)::int from public.company_log where source='reply_cards' and source_id in
 (select id from public.reply_cards where channel_message_id in (current_setting('test.owner')::bigint,current_setting('test.manager')::bigint,current_setting('test.team')::bigint))),3,
 'one log row per card shown, from the four calls made and the one refused');
select results_eq($$select details->'card'->>'kind',details->'card'->>'fine',details->'card'->>'edits' from public.company_log where source='reply_cards' and source_id=(select id from public.reply_cards where kind='review' and channel_message_id=current_setting('test.manager')::bigint)$$,
 $$values ('review','1','1')$$,'the review''s row carries its counts');
select is((select team_log from seen where who=3),1,'the member who called the hidden Agent reads its card''s log row');
select is((select team_log from seen where who=4),1,'and so does the Viewer in that channel');
select is((select team_log from seen where who=2),0,'a Manager outside the team channel reads no row for it');
select is((select team_log from seen where who=6),0,'and another Company reads none');

select * from finish();
rollback;
