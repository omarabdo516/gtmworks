-- #873: a change the Engine did not take is a line too, and a refusal may name its page; still only a signed-in Owner writes.
select json_build_object(
 'only_people_log',has_function_privilege('authenticated','public.log_engine_dashboard(uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.log_engine_dashboard(uuid,text,text,text)','execute')
  and not has_function_privilege('service_role','public.log_engine_dashboard(uuid,text,text,text)','execute'),
 'owners_only',position('is_company_owner' in pg_get_functiondef('public.log_engine_dashboard(uuid,text,text,text)'::regprocedure))>0,
 'not_taken_kept',position('''rejected''' in pg_get_functiondef('public.log_engine_dashboard(uuid,text,text,text)'::regprocedure))>0
);
