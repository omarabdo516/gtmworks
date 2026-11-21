begin;
create extension if not exists pgtap with schema extensions;
select plan(25);
-- #166. What an "Always allow" keeps in the Engine is kept on the request (`allows`), so each standing entry names who
-- allowed it and when; everyone who sees the Agent reads that, only an active Owner or Manager who sees it may revoke,
-- and a revoke is one Company log row. RS Learning: 1 Owner, 2 Manager, 3 and 5 Contributors, 4 Viewer. Ads (own
-- profile) is shown to 2-5; SEO (own profile) to nobody but the Owner. Karim is a Manager of Aleem only, whose Sara is
-- another Company's Agent.
insert into public.agent_profiles(agent_id,company_id) values
 ('e5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'),('e5000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('e5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000012','Ads','Ads','ag-e5000000000000000000000000000002'),
 ('e5000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000013','SEO','SEO','ag-e5000000000000000000000000000003'),
 ('e5000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','e5000000-0000-0000-0000-000000000014','Sara','Writing','standing-test-sara');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e5000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
-- e6…1: the Owner with Ads; e6…2: the Manager with Ads; e6…3: the Owner with SEO.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e6000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002','Ads'),
 ('e6000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','e5000000-0000-0000-0000-000000000002','Ads'),
 ('e6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000003','SEO');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Launch it',gen_random_uuid(),'s-run-1'),
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Mona','Clean up',gen_random_uuid(),'s-run-2'),
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000001','Omar','Publish it',gen_random_uuid(),'s-run-3'),
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Again',gen_random_uuid(),'s-run-4'),
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Once more',gen_random_uuid(),'s-run-5');
insert into auth.users(id,email) values ('e7000000-0000-0000-0000-000000000001','karim-standing@example.test');
insert into public.people(id,name) values ('e7000000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-000000000001','manager');

set local role service_role;
select public.track_run_permission('e6000000-0000-0000-0000-000000000001','s-run-1','{"id":"b1","description":"Launch the campaign","command":"MCP tool","choices":["once","always","deny"],"allows":["mcp:meta-ads/create_campaign"]}',false,now(),run_profile=>'ag-e5000000000000000000000000000002');
select public.track_run_permission('e6000000-0000-0000-0000-000000000002','s-run-2','{"id":"b2","description":"recursive delete","command":"rm -rf exports","choices":["once","always","deny"],"allows":["recursive delete"]}',false,now(),run_profile=>'ag-e5000000000000000000000000000002');
select public.track_run_permission('e6000000-0000-0000-0000-000000000003','s-run-3','{"id":"b3","description":"Publish the article","command":"MCP tool","choices":["once","always","deny"],"allows":["mcp:wordpress/publish_post"]}',false,now(),run_profile=>'ag-e5000000000000000000000000000003');
-- On a profile that is not the Agent's own always is not offered, so nothing is kept; a malformed list keeps nothing.
select public.track_run_permission('e6000000-0000-0000-0000-000000000001','s-run-4','{"id":"b4","description":"Launch","command":"x","choices":["once","always","deny"],"allows":["mcp:meta-ads/create_campaign"]}',false,now(),run_profile=>'co-shared');
select public.track_run_permission('e6000000-0000-0000-0000-000000000001','s-run-5','{"id":"b5","description":"Launch","command":"x","choices":["once","always","deny"],"allows":["ok",3]}',false,now(),run_profile=>'ag-e5000000000000000000000000000002');
reset role;
select results_eq($$select call_id,allows from public.reply_cards where kind='permission' and call_id like 'b%' order by call_id$$,
 $$values ('b1','{mcp:meta-ads/create_campaign}'::text[]),('b2','{"recursive delete"}'::text[]),('b3','{mcp:wordpress/publish_post}'::text[]),('b4',null::text[]),('b5',null::text[])$$,
 'a request keeps what always would keep, and none where always is not offered or the list is not one');
select throws_ok($$update public.reply_cards set allows='{" padded"}' where call_id='b1'$$,'23514',null,'an entry is kept only as the Engine keys it');

-- Each person answers their own request; the Engine takes it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.decide_permission('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001',(select id from public.reply_cards where call_id='b1'),'always');
select public.decide_permission('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000003',(select id from public.reply_cards where call_id='b3'),'always');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.decide_permission('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002',(select id from public.reply_cards where call_id='b2'),'always');
reset role;
select set_config('test.claimed',(select string_agg(id::text,',') from public.reply_cards where call_id in ('b1','b2','b3')),true);
set local role service_role;
select public.settle_permission(n::bigint,'decided') from unnest(string_to_array(current_setting('test.claimed'),',')) n;
reset role;

-- Who allowed each entry, for everyone who sees the Agent.
create temporary table granted(reader int, agent text, entry text, allowed_by text, allowed boolean);
grant insert on granted to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into granted select 1,'ads',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002');
insert into granted select 1,'seo',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000003');
insert into granted select 1,'sara',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000004');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into granted select 2,'ads',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002');
insert into granted select 2,'seo',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into granted select 3,'ads',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into granted select 4,'ads',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','e7000000-0000-0000-0000-000000000001',true);
insert into granted select 6,'ads',entry,allowed_by,allowed_at is not null from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002');
reset role;
select set_config('test.ads',$$values ('mcp:meta-ads/create_campaign',(select name from public.people where id='20000000-0000-0000-0000-000000000001'),true),('recursive delete',(select name from public.people where id='20000000-0000-0000-0000-000000000002'),true)$$,true);
select results_eq($$select entry,allowed_by,allowed from granted where reader=1 and agent='ads' order by entry$$,current_setting('test.ads'),'the Owner reads who allowed each of the Agent''s entries, and when');
select results_eq($$select entry,allowed_by,allowed from granted where reader=2 and agent='ads' order by entry$$,current_setting('test.ads'),'so does a Manager who sees the Agent');
select results_eq($$select entry,allowed_by,allowed from granted where reader=3 and agent='ads' order by entry$$,current_setting('test.ads'),'and a Contributor');
select results_eq($$select entry,allowed_by,allowed from granted where reader=4 and agent='ads' order by entry$$,current_setting('test.ads'),'and a Viewer');
select results_eq($$select entry from granted where reader=1 and agent='seo'$$,$$values ('mcp:wordpress/publish_post')$$,'another Agent''s entries are its own: none of Ads''s shows on SEO, nor SEO''s on Ads');
select is((select count(*)::int from granted where reader=2 and agent='seo'),0,'a Member who does not see the Agent reads none of it');
select is((select count(*)::int from granted where agent='sara'),0,'an Agent of another Company is not found from this one');
select is((select count(*)::int from granted where reader=6),0,'nor does a Member of another Company read this one''s');

-- Only an active Owner or Manager who sees the Agent may revoke, and the log asks again.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,'the Owner may revoke');
select throws_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000004')$$,'42501','permissionNotAllowed','never another Company''s Agent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,'a Manager who sees the Agent may revoke');
select throws_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000003')$$,'42501','permissionNotAllowed','not on an Agent the Manager does not see');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,'42501','permissionNotAllowed','a Contributor may not');
select throws_ok($$select public.log_permission_revoked('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002','Meta Ads · create_campaign','mcp:meta-ads/create_campaign')$$,'42501','permissionNotAllowed','nor log a revoke');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,'42501','permissionNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','e7000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_permission_revoke('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,'42501','permissionNotAllowed','nor a Manager of another Company');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_permission_revoked('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002',' ','mcp:meta-ads/create_campaign')$$,'22023','permissionInvalid','a revoke names its permission');
select public.log_permission_revoked('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002','Meta Ads · create_campaign','mcp:meta-ads/create_campaign');
reset role;
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='agent_permission_revoked'),
 jsonb_build_array('20000000-0000-0000-0000-000000000002','person','agent','e5000000-0000-0000-0000-000000000002','agent_permission_revoked',
  jsonb_build_object('agent_name','Ads','permission',jsonb_build_object('text','Meta Ads · create_campaign','entry','mcp:meta-ads/create_campaign'))),
 'a revoke is one log row: who, the Agent and the permission');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.company_log where action='agent_permission_revoked'),1,'everyone who sees the Agent reads it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.log_permission_revoked('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000003','WordPress · publish_post','mcp:wordpress/publish_post');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_log where action='agent_permission_revoked'),1,'and a Member who does not see the Agent reads none of its revokes');
select results_eq($$select entry from public.agent_permission_grants('10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000002')$$,$$values ('recursive delete')$$,
 'a revoked grant no longer names the person behind its entry, and the other entry keeps its own');
reset role;
select ok(not has_function_privilege('anon','public.agent_permission_grants(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.check_permission_revoke(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.log_permission_revoked(uuid,uuid,text,text)','execute'),'no signed-out caller reaches them');
select ok(not has_function_privilege('authenticated','public.permission_allows_of(jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.permission_allows_valid(text[])','execute'),'the helpers are no one''s to call');
select * from finish();
rollback;
