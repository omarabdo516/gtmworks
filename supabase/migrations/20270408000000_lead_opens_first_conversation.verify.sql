-- #434: the soul check list and the opening are the service role's alone, and the brief carries the opening.
select json_build_object(
 'soul_flag',exists(select 1 from pg_attribute where attrelid='public.company_profiles'::regclass and attname='lead_soul_checked' and not attisdropped),
 'worker_only',bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')),
 'searched',bool_and(p.prosecdef and p.proconfig=array['search_path=""']),
 'written_rule_private',not has_function_privilege('authenticated','public.written_message(public.conversation_messages)','execute')
  and not has_function_privilege('service_role','public.written_message(public.conversation_messages)','execute'),
 'brief_carries_opening',position('lead-opening' in pg_get_functiondef('public.pin_lead_brief(uuid,uuid)'::regprocedure))>0
) from unnest(array['public.lead_soul_work()','public.record_lead_soul(uuid,text)','public.open_first_conversation(uuid,uuid,uuid,text)','public.pin_lead_brief(uuid,uuid)']::regprocedure[]) f join pg_proc p on p.oid=f;
