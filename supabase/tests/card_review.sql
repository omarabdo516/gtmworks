begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
-- #681 (spec #668, ADR 0026): one review, decided by any Owner or Manager who sees the Card, on the exact Version; the
-- first answer closes it. Approved goes to Planned with the approved Version when its date is ahead, else to Done; sent
-- back goes to In progress with the reason as a comment. A later Version needs its own Approval. Approval steps are gone:
-- a Card already waiting on one is a review for every Owner and Manager who sees it (#513).
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000681','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000681','card-review','Card review','e3821000-0000-4000-8000-000000000681');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000681','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000681','20000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000681','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000681','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6810000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000681','f6810000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6810000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000681','f6810000-0000-0000-0000-000000000002','SEO','SEO',false,'default');
insert into public.work_cards(company_id,status,title,go_live,assignee_agent) values
 ('10000000-0000-0000-0000-000000000681','progress','Rev ahead',now()+interval '5 days',null),
 ('10000000-0000-0000-0000-000000000681','progress','Rev past',now()-interval '1 day',null),
 ('10000000-0000-0000-0000-000000000681','progress','Rev back',null,null),
 ('10000000-0000-0000-0000-000000000681','progress','Rev empty',null,null),
 ('10000000-0000-0000-0000-000000000681','progress','Rev hidden',null,'a6810000-0000-0000-0000-000000000002');
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000681' and title='Rev '||t $$;
grant execute on function pg_temp.id(text) to authenticated;
-- One Version on each Card but "empty".
insert into public.work_creatives(company_id,card_id,name) select company_id,id,'Design' from public.work_cards where company_id='10000000-0000-0000-0000-000000000681' and title<>'Rev empty';
insert into public.work_versions(company_id,card_id,creative_id,path) select company_id,card_id,id,company_id||'/'||card_id||'/1' from public.work_creatives where company_id='10000000-0000-0000-0000-000000000681';
create function pg_temp.v(t text) returns bigint language sql as $$ select max(id) from public.work_versions where card_id=pg_temp.id(t) $$;
grant execute on function pg_temp.v(text) to authenticated;
create function pg_temp.status(t text) returns text language sql as $$ select status from public.work_cards where id=pg_temp.id(t) $$;
grant execute on function pg_temp.status(text) to authenticated;
create function pg_temp.decide(t text,decision text,reason text default null) returns text language sql as $$
 select public.decide_review('10000000-0000-0000-0000-000000000681',pg_temp.id(t),pg_temp.v(t),decision,reason) $$;
grant execute on function pg_temp.decide(text,text,text) to authenticated;
create function pg_temp.waiting() returns text language sql as $$
 select coalesce(string_agg(title,',' order by title),'') from public.waiting_list('10000000-0000-0000-0000-000000000681') where kind='approval' $$;
grant execute on function pg_temp.waiting() to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- A Contributor asks for reviews.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select isnt(public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('ahead')),null,'a Contributor asks for a review');
select is(pg_temp.status('ahead'),'waiting','the Card waits on you');
select lives_ok($$select public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('past'))$$,'a second Card is asked');
select lives_ok($$select public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('back'))$$,'and a third');
select throws_ok($$select public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('ahead'))$$,'P0001','already in review','a Card in review is not asked twice');
select lives_ok($$select public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('empty'))$$,'a Card with no Version yet is reviewed as it is');
select is((select version_id from public.work_reviews where card_id=pg_temp.id('ahead')),pg_temp.v('ahead'),'the review is on the Card''s latest Version');
select is(pg_temp.waiting(),'','a Contributor has no review waiting on them');
select throws_ok($$select pg_temp.decide('ahead','approve')$$,'42501','not permitted','and decides none');

-- A Manager and the Owner see every open review of a Card they see.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.waiting(),'Rev ahead,Rev back,Rev empty,Rev past','a Manager has each open review waiting on them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.waiting(),'Rev ahead,Rev back,Rev empty,Rev past','and so has the Owner');

-- The exact Version: a later one needs its own review.
reset role;
insert into public.work_versions(company_id,card_id,creative_id,path) select company_id,card_id,creative_id,company_id||'/'||card_id||'/2' from public.work_versions where card_id=pg_temp.id('ahead');
set local role authenticated;
select throws_ok($$select pg_temp.decide('ahead','approve')$$,'P0001','version changed','a decision on another Version than the one asked is refused');
select is(public.decide_review('10000000-0000-0000-0000-000000000681',pg_temp.id('ahead'),(select min(id) from public.work_versions where card_id=pg_temp.id('ahead')),'approve'),'planned','approved with its date ahead, the Card is Planned');
select is((select approved_version from public.work_cards where id=pg_temp.id('ahead')),(select min(id) from public.work_versions where card_id=pg_temp.id('ahead')),'approved on that Version');
select isnt((select approved_version from public.work_cards where id=pg_temp.id('ahead')),pg_temp.v('ahead'),'so the later Version is not approved');
select is((select count(*)::int from public.work_activity where card_id=pg_temp.id('ahead') and action='approval_approved'),1,'the Approval is logged');

-- The first answer closes it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.decide('past','approve'),'done','a Manager approves; with its date past, the Card is Done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select pg_temp.decide('past','send_back','Too late')$$,'P0001','review closed','a second answer finds the review closed');
select is(pg_temp.status('past'),'done','and the first answer stands');

-- Sent back with a reason, which the team reads as a comment.
select throws_ok($$select pg_temp.decide('back','send_back','  ')$$,'22023','reason required','sending back needs a reason');
select is(pg_temp.decide('back','send_back','Shorter caption'),'progress','sent back, the Card is In progress');
select is((select body from public.work_comments where card_id=pg_temp.id('back')),'Shorter caption','the reason is a comment');
select is((select decision||' '||reason from public.work_reviews where card_id=pg_temp.id('back')),'sent_back Shorter caption','the review keeps the decision and its reason');
select is(public.decide_review('10000000-0000-0000-0000-000000000681',pg_temp.id('empty'),null,'approve'),'done','a review of a Card with no Version is decided as it is');
select is((select (approved_at is not null) and approved_version is null from public.work_cards where id=pg_temp.id('empty')),true,'approved with no Version');
select is(pg_temp.waiting(),'','nothing is waiting once every review is answered');

-- Who may not decide.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.ask_review('10000000-0000-0000-0000-000000000681',pg_temp.id('back'))$$,'the Card sent back is asked again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.decide('back','approve')$$,'42501','not permitted','a Viewer decides nothing');
reset role;
-- A Card whose Agent is hidden from the Manager: the Owner decides it (#513).
insert into public.work_reviews(company_id,card_id,version_id) values('10000000-0000-0000-0000-000000000681',pg_temp.id('hidden'),pg_temp.v('hidden'));
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select pg_temp.decide('hidden','approve')$$,'P0002','card not found or not permitted','a Manager does not decide a Card whose Agent is hidden from them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.waiting(),'Rev back,Rev hidden','the Owner, who sees every Agent, has it waiting');

-- The previous release: a Card it puts on an approval step is in review here, and closing the step closes the review.
reset role;
insert into public.approval_steps(company_id,name,position,role) values('10000000-0000-0000-0000-000000000681','Owner OK',1,'owner');
select set_config('approval.internal','yes',true);
update public.work_cards set status='waiting', approval_step_id=(select id from public.approval_steps where company_id='10000000-0000-0000-0000-000000000681' and name='Owner OK') where id=pg_temp.id('empty');
select is((select count(*)::int from public.work_reviews where card_id=pg_temp.id('empty') and decision is null),1,'a Card put on a step by the previous release is in review');
update public.work_cards set status='planned', approval_step_id=null where id=pg_temp.id('empty');
select set_config('approval.internal','',true);
select is((select decision from public.work_reviews where card_id=pg_temp.id('empty') order by id desc limit 1),'approved','and the step it closed closes the review');

select * from finish();
rollback;
