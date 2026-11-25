-- #684, ADR 0023: after the Card cutover a Card has one status, one assignee and a description, and nothing of the board
-- before it is left: no stages, labels, checklist, other assignees, next actor, mode, marketing fields or approval
-- steps, and no function that read or wrote them. What every Card kept (Versions, files, comments, log rows) stays.
select json_build_object(
 'old_tables_gone',(select bool_and(to_regclass('public.'||t) is null) from unnest(array['work_stages','work_labels','work_card_labels','work_checklist','work_assignees','approval_steps']) t),
 'old_columns_gone',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards'
  and column_name in ('stage_id','next_actor','mode','approval_step_id','offering','segment','hook','channel','format','goal','caption')),
 'old_functions_gone',not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('align_card_status','card_status_stage','approval_card_guard',
  'approval_actor','approval_holds','approval_defaults','backfill_review_approvals','save_approval_step','remove_approval_step','decide_approval','review_from_steps',
  'schedule_approved_card','work_guard','work_defaults','work_stage_column','work_stage_place','work_stage_key_guard','guard_work_stage_kind','required_work_stage',
  'move_work_card','move_work_card_to_column','place_work_card','undo_work_card_move','create_work_card','create_card_request','agent_write','start_card_conversation','assignee_from_list')),
 'no_function_reads_them',not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prolang<>13 and p.prokind='f'
  and p.prosrc ~ '(work_stages|work_labels|work_card_labels|work_checklist|work_assignees|approval_steps|stage_id|next_actor|approval_step_id)'),
 'every_card_placed',not exists(select 1 from public.work_cards where status is null or board_order is null),
 'one_assignee',exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_one_assignee')
  and exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='align_card_assignee' and not tgisinternal),
 -- The spec's own writers are for signed-in Members only; edit_work_card and change_work_card, made again on the new
 -- shape, keep the grants they had.
 'the_final_writers',(select bool_and(to_regprocedure(f) is not null and has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','public.move_card(uuid,bigint,text,bigint,text)','public.undo_card_move(uuid,bigint)',
   'public.assign_card(uuid,bigint,uuid,uuid)','public.save_card(uuid,bigint,text,text,text)','public.ask_review(uuid,bigint)','public.decide_review(uuid,bigint,bigint,text,text)']) f)
  and (select bool_and(to_regprocedure(f) is not null and has_function_privilege('authenticated',f,'execute'))
  from unnest(array['public.edit_work_card(uuid,bigint,jsonb,text)','public.change_work_card(uuid,bigint,text,jsonb,text)']) f),
 'kept_tables',(select bool_and(to_regclass('public.'||t) is not null) from unnest(array['work_creatives','work_versions','work_attachments','work_comments','work_activity','work_card_moves','work_reviews']) t)
);
