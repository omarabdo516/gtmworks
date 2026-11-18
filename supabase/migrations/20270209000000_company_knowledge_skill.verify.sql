-- The knowledge's table and run pins are gone; a save is checked and logged for the signed-in person only.
select json_build_object(
 'table_gone',to_regclass('public.company_knowledge') is null,
 'pins_gone',(select bool_and(to_regprocedure(f) is null) from unnest(array['public.pin_run_knowledge(uuid,uuid)','public.channel_run_knowledge(bigint)','public.note_run_knowledge(bigint)',
  'public.pin_channel_run_knowledge()','public.company_knowledge_now(uuid)','public.save_company_knowledge(uuid,text,text)']) f)
  and not exists(select 1 from pg_attribute where attrelid in ('public.conversation_run_notes'::regclass,'public.channel_runs'::regclass,'public.note_runs'::regclass) and attname='knowledge' and not attisdropped),
 'checked_for_members',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.check_company_knowledge(uuid,text,text)','public.log_company_knowledge(uuid,text,boolean)']) f)
  and (select bool_and(prosecdef and proconfig=array['search_path=""'] and position('can_manage_company(c)' in pg_get_functiondef(oid))>0) from pg_proc
   where oid in ('public.check_company_knowledge(uuid,text,text)'::regprocedure,'public.log_company_knowledge(uuid,text,boolean)'::regprocedure))
  and position('secret_like(kept)' in pg_get_functiondef('public.check_company_knowledge(uuid,text,text)'::regprocedure))>0,
 'parts_in_order',public.company_knowledge_parts()=array['voice','audience','products','banned','decisions']
);
