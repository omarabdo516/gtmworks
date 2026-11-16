-- A review is a known kind beside the draft, which holds as before; any Agent's runs are offered show_review beside
-- show_draft; a review's log row carries how many reviewed texts are fine and how many need an edit; the functions keep
-- their grants.
select json_build_object(
 'review_is_a_kind',public.reply_card_valid('review','shown','{"line":"3 texts · Meta Ads","items":[{"text":"From graduate to accountant","fine":true,"note":"Clear."},{"text":"The surest way","fine":false,"note":"We cannot prove it."}],"decision":"2 ready, 1 back to Ads"}')
  and not public.reply_card_valid('review','answered','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}],"decision":"C"}')
  and not public.reply_card_valid('review','shown','{"line":"3 texts","items":[],"decision":"C"}')
  and not public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":"yes","note":"B"}],"decision":"C"}')
  and not public.reply_card_valid('review','shown','{"line":"3 texts","items":[{"text":"A","fine":true,"note":"B"}]}'),
 'draft_holds_as_before',public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"Leads"}]}')
  and public.reply_card_valid('draft','shown','{"line":"Draft · Meta Ads","rows":[]}')
  and not public.reply_card_valid('draft','shown','{"line":"Draft","rows":[],"decision":"C"}'),
 'offered_beside_show_draft',position('''show_draft''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))
  between 1 and position('''show_review''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure)),
 'review_logged_with_its_counts',position('''edits''' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0
  and position('''agent_card_shown''' in pg_get_functiondef('public.agent_show_card(uuid,text,text,text,text,jsonb)'::regprocedure))>0,
 'worker_shows',has_function_privilege('service_role','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.agent_show_card(uuid,text,text,text,text,jsonb)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.reply_card_valid(text,text,jsonb)','public.run_tools(uuid,uuid,uuid)']) f)
);
