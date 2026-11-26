-- #873 (spec #866): the Owner's Engine dashboard writes to the Company log who opened it (one line a visit: none again
-- for that person and Company within thirty minutes), each change with its page and kind, and each refused action. Only
-- an Owner of the Company writes them, only Owners read them, and a line carries nothing but the fixed words it is
-- given: any other page, kind or refusal is refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

set local role authenticated;
-- omar@example.com: Owner of rs-learning.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','opened',null,null)$$,'an Owner opening the dashboard is logged');
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','opened',null,null)$$,'and opening it again soon after is the same visit');
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','changed','keys','keySaved')$$,'a change is logged with its page and kind');
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','changed',null,'changed')$$,'a change on no known page is logged with no page');
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','refused',null,'hermesUpdate')$$,'a refused action is logged');
select throws_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','changed','keys','sk-or-secret')$$,'22023',null,'a kind that is not one of the words is refused');
select throws_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','changed','OPENROUTER_API_KEY=sk','keySaved')$$,'22023',null,'so is a page that is not one');
select throws_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','refused',null,'something')$$,'22023',null,'and a refusal that is not one of the four');
select throws_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','read',null,null)$$,'22023',null,'and anything but a visit, a change or a refusal');

-- manager@example.com: Manager of rs-learning.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000001','opened',null,null)$$,'42501',null,'a Manager writes no dashboard line');
select is((select count(*)::int from public.company_log where source='engine_dashboard'),0,'nor reads one');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.company_log where source='engine_dashboard'),4,'an Owner reads them');

reset role;
select is((select count(*)::int from public.company_log where source='engine_dashboard' and action='engine_dashboard_opened'),1,'two openings in a row are one visit line');
select is((select (actor_id,actor_kind,subject) from public.company_log where source='engine_dashboard' and action='engine_dashboard_changed' and details ? 'page'),
 ('20000000-0000-0000-0000-000000000001'::uuid,'person'::text,'company'::text),'the line names the person who made the change');
select is((select details-'private' from public.company_log where source='engine_dashboard' and action='engine_dashboard_changed' and details ? 'page'),
 '{"page":"keys","change":"keySaved"}'::jsonb,'with the page and the kind, and nothing else');
select is((select details-'private' from public.company_log where source='engine_dashboard' and action='engine_dashboard_refused'),
 '{"refused":"hermesUpdate"}'::jsonb,'a refused line names which of the four it was');

-- A visit thirty minutes past the last is a new one: the Owner's last opening line in rs-consultations is 31 minutes old.
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
 values('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','person','Omar','company','engine_dashboard_opened',
  '{"private":"owners"}','engine_dashboard',nextval('public.engine_dashboard_log_ids'),now()-interval '31 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.log_engine_dashboard('10000000-0000-0000-0000-000000000002','opened',null,null)$$,'an Owner opens the dashboard again later');
reset role;
select is((select count(*)::int from public.company_log where source='engine_dashboard' and company_id='10000000-0000-0000-0000-000000000002'),2,'and that is a visit line of its own');
select * from finish();
rollback;
