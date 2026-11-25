-- #681: one review on an exact Version, decided by an Owner or a Manager who sees the Card; no Card is left waiting on
-- an approval step outside a review.
select json_build_object(
 'reviews',to_regclass('public.work_reviews') is not null,
 'one_open',exists(select 1 from pg_indexes where schemaname='public' and indexname='work_reviews_one_open'),
 'read_rules',(select count(*)=2 from pg_policies where schemaname='public' and tablename='work_reviews' and policyname in ('work_read','card_agent_visible')),
 'written_by_functions_only',not has_table_privilege('authenticated','public.work_reviews','insert') and not has_table_privilege('authenticated','public.work_reviews','update'),
 'ask',has_function_privilege('authenticated','public.ask_review(uuid,bigint)','execute') and not has_function_privilege('anon','public.ask_review(uuid,bigint)','execute') and not has_function_privilege('service_role','public.ask_review(uuid,bigint)','execute'),
 'decide',has_function_privilege('authenticated','public.decide_review(uuid,bigint,bigint,text,text)','execute') and not has_function_privilege('anon','public.decide_review(uuid,bigint,bigint,text,text)','execute') and not has_function_privilege('service_role','public.decide_review(uuid,bigint,bigint,text,text)','execute'),
 'approved',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name in ('approved_version','approved_at')),
 'no_step_outside_review',not exists(select 1 from public.work_cards w where w.approval_step_id is not null and w.status='waiting' and w.archived_at is null
  and not exists(select 1 from public.work_reviews r where r.card_id=w.id and r.decision is null))
);
