-- #677: a Card has at most one assignee, assigned with assign_card by signed-in Members only; until the cutover (#684)
-- the Card's Agent always equals its assignee Agent, and removals leave Cards assigned to nobody.
select json_build_object(
 'assignee',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name in ('assignee_agent','assignee_person')),
 'one_assignee',exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_one_assignee'),
 'member_only',has_function_privilege('authenticated','public.assign_card(uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.assign_card(uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.assign_card(uuid,bigint,uuid,uuid)','execute'),
 'both_shapes',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='align_card_assignee' and not tgisinternal),
 'agent_is_assignee',not exists(select 1 from public.work_cards w where w.agent_id is distinct from w.assignee_agent),
 'removals_unassign',(select count(*)=2 from pg_trigger where tgname in ('unassign_removed_agent','unassign_removed_member') and not tgisinternal),
 'no_viewer_assignee',not exists(select 1 from public.work_cards w join public.members m on m.company_id=w.company_id and m.person_id=w.assignee_person where m.role='viewer' or m.removed_at is not null)
);
