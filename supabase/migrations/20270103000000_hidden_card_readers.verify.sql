with replaced(fn,result,definer,callers) as (values
 ('public.agent_write(uuid,text,text,text,bigint,jsonb)','jsonb',false,array['anon','authenticated','service_role']),
 ('public.decide_approval(uuid,bigint,text,text,boolean,boolean)','void',true,array['anon','authenticated','service_role']),
 ('public.edit_card_note(uuid,bigint,text)','boolean',true,array['authenticated'])),
found as (select r.*,p.* from replaced r left join pg_proc p on p.oid=to_regprocedure(r.fn))
select json_build_object(
 'previous_app_calls_resolve',(select bool_and(oid is not null) from found),
 'replaced_not_added',(select bool_and((select count(*) from pg_proc o where o.pronamespace='public'::regnamespace and o.proname=found.proname)=1) from found),
 'results_kept',(select bool_and(pg_get_function_result(oid)=result) from found),
 'security_kept',(select bool_and(prosecdef=definer) from found),
 'search_path_kept',(select bool_and(proconfig=array['search_path=""']) from found),
 'grants_kept',(select bool_and(array(select r from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r,oid,'execute') order by r)=callers) from found),
 'hidden_card_answers_as_missing',(select bool_and(prosrc ~ 'public\.(can_see_card|agent_visible_to)\s*\(') from found),
 'waiting_list_reads_under_the_rules',(select not prosecdef from pg_proc where oid='public.waiting_list(uuid)'::regprocedure),
 'read_rules_unchanged',(select count(*)=13 from pg_policies where schemaname='public' and policyname='card_agent_visible')
  and (select count(*)=12 from pg_policies where schemaname='public' and policyname='card_agent_visible_write')
  and (select count(*)=2 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('card_file_visible','card_file_visible_write'))
);
