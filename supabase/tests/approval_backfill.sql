begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- Simulate a card that was already in review before the approval migration.
select set_config('approval.internal','yes',true);
update public.work_cards set approval_step_id=null, review_submitter=null, review_entered_at=null where id=5;
select public.backfill_review_approvals();
select is((select approval_step_id from public.work_cards where id=5),(select id from public.approval_steps where company_id='10000000-0000-0000-0000-000000000001' and position=1),'existing review card enters first step');
select is((select review_submitter from public.work_cards where id=5),'30000000-0000-0000-0000-000000000001'::uuid,'recorded submitter is recovered');
select is((select next_actor from public.work_cards where id=5),'20000000-0000-0000-0000-000000000001'::uuid,'current approver owns card');
select ok((select review_entered_at is not null from public.work_cards where id=5),'queue time is recovered');
select set_config('approval.internal','',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.decide_approval('10000000-0000-0000-0000-000000000001',5,'reject','تعديل التصميم',false,true)$$,'backfilled card can be decided');
select * from finish();
rollback;
