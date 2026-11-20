-- #452: agent_write makes an idea, with its Agent, under the request key. Only replaces it, keeping its arguments, result,
-- security, search path and grants: the previous app version calls it as before.
with replaced(fn,result,definer,callers) as (values
 ('public.agent_write(uuid,text,text,text,bigint,jsonb)','jsonb',false,array['anon','authenticated','service_role'])),
found as (select r.*,p.* from replaced r left join pg_proc p on p.oid=to_regprocedure(r.fn))
select json_build_object(
 'previous_app_calls_resolve',(select bool_and(oid is not null) from found),
 'replaced_not_added',(select bool_and((select count(*) from pg_proc o where o.pronamespace='public'::regnamespace and o.proname=found.proname)=1) from found),
 'results_kept',(select bool_and(pg_get_function_result(oid)=result) from found),
 'security_kept',(select bool_and(prosecdef=definer) from found),
 'search_path_kept',(select bool_and(proconfig=array['search_path=""']) from found),
 'grants_kept',(select bool_and(array(select r from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r,oid,'execute') order by r)=callers) from found),
 'idea_op',(select bool_and(position('when ''idea''' in pg_get_functiondef(oid))>0) from found),
 'run_key_guard_kept',(select bool_and(position('run_card' in pg_get_functiondef(oid))>0) from found)
);
