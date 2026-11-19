-- #378 (S1): the installer adopts the Engine a previous-release install already runs as its one Company's Engine, in one
-- transaction, and only server code may call it. A Company that already names its Engine is left alone.
select json_build_object(
 'adopt_engine_private',not has_function_privilege('anon','public.adopt_engine(text,text)','execute')
  and not has_function_privilege('authenticated','public.adopt_engine(text,text)','execute')
  and has_function_privilege('service_role','public.adopt_engine(text,text)','execute'),
 'adopt_engine_names_company',position('update public.companies set engine_id=engine' in pg_get_functiondef('public.adopt_engine(text,text)'::regprocedure))>0,
 'adopt_engine_refuses_several',position('missing>1' in pg_get_functiondef('public.adopt_engine(text,text)'::regprocedure))>0
);
