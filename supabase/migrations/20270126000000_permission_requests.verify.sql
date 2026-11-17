-- A permission request is a known kind beside the draft, the review, the question and the hand card, which hold as
-- before: an open card holds no choice and a sending or decided one holds one it was offered; who decided and when are
-- kept exactly on a card that holds a choice; a Run's end closes its requests; the role rule is one function; a decision
-- is logged from the answers' source; the functions keep their grants.
select json_build_object(
 'permission_is_a_kind',public.reply_card_valid('permission','open','{"description":"delete the old exports","command":"rm -r exports","choices":["once","always","deny"]}')
  and public.reply_card_valid('permission','open','{"description":"","command":"rm -r exports","choices":["once","deny"]}')
  and public.reply_card_valid('permission','closed','{"description":"delete the old exports","command":"","choices":["once","deny"]}')
  and public.reply_card_valid('permission','sending','{"description":"delete the old exports","command":"rm -r exports","choices":["once","always","deny"],"choice":"always"}')
  and public.reply_card_valid('permission','decided','{"description":"delete the old exports","command":"rm -r exports","choices":["once","deny"],"choice":"deny"}')
  and public.reply_card_valid('permission','closed','{"description":"delete the old exports","command":"rm -r exports","choices":["once","deny"],"choice":"once"}')
  and not public.reply_card_valid('permission','open','{"description":"delete","command":"rm","choices":["once","deny"],"choice":"once"}')
  and not public.reply_card_valid('permission','decided','{"description":"delete","command":"rm","choices":["once","deny"]}')
  and not public.reply_card_valid('permission','decided','{"description":"delete","command":"rm","choices":["once","deny"],"choice":"always"}')
  and not public.reply_card_valid('permission','shown','{"description":"delete","command":"rm","choices":["once","deny"]}')
  and not public.reply_card_valid('permission','open','{"description":" ","command":"","choices":["once","deny"]}')
  and not public.reply_card_valid('permission','open','{"description":"delete","command":"rm","choices":["once"]}')
  and not public.reply_card_valid('permission','open','{"description":"delete","command":"rm","choices":["once","session","deny"]}')
  and not public.reply_card_valid('permission','open','{"description":"delete","command":"rm","choices":["once","deny","deny"]}')
  and not public.reply_card_valid('permission','open','{"description":"delete","choices":["once","deny"]}'),
 'others_hold_as_before',public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}],"decision":"C"}')
  and public.reply_card_valid('question','open','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false}')
  and public.reply_card_valid('question','answered','{"question":"Which audience first?","choices":["Parents","Students"],"multiple":false,"answer":"Students"}')
  and public.reply_card_valid('hand','open','{"app":"WordPress","line":"The draft is ready","rows":[{"label":"Title","value":"Accounting in 3 months"}]}')
  and not public.reply_card_valid('question','decided','{"question":"Which?","choices":[],"multiple":false}')
  and not public.reply_card_valid('hand','decided','{"app":"WordPress","line":"The draft is ready","rows":[]}'),
 'decided_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name in ('decided_by','decided_at'))=2
  and exists(select 1 from pg_constraint where conname='reply_cards_decided' and conrelid='public.reply_cards'::regclass),
 'run_end_closes_permissions',exists(select 1 from pg_trigger where tgname='conversation_usage_closes_permissions' and tgrelid='public.conversation_usage'::regclass),
 'always_on_the_agents_own_profile',position('agent_engine_profile' in pg_get_functiondef('public.track_run_permission(uuid,text,jsonb,boolean,timestamptz)'::regprocedure))>0,
 'logged_from_the_answers',position('''agent_permission_decided''' in pg_get_functiondef('public.settle_permission(bigint,text)'::regprocedure))>0
  and position('''reply_card_answers''' in pg_get_functiondef('public.settle_permission(bigint,text)'::regprocedure))>0,
 'person_decides',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.decide_permission(uuid,uuid,bigint,text)','public.permission_choices(uuid)']) f),
 'closers_track_and_settle',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.track_run_permission(uuid,text,jsonb,boolean,timestamptz)','public.settle_permission(bigint,text)']) f),
 'trigger_private',(select bool_and(not has_function_privilege(r,'public.close_ended_run_permissions()','execute')) from unnest(array['anon','authenticated','service_role']) r)
);
