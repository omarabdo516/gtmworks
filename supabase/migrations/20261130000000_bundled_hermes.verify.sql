select json_build_object(
 'service_only',has_function_privilege('service_role','public.bundled_hermes_waiting()','execute') and not has_function_privilege('authenticated','public.bundled_hermes_waiting()','execute') and not has_function_privilege('anon','public.bundled_hermes_waiting()','execute')
  and has_function_privilege('service_role','public.provide_bundled_hermes(text,text,text,text,text[])','execute') and not has_function_privilege('authenticated','public.provide_bundled_hermes(text,text,text,text,text[])','execute') and not has_function_privilege('anon','public.provide_bundled_hermes(text,text,text,text,text[])','execute')
);
