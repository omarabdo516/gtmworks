-- answer_question keeps its grants: the person's session runs it, and no other role does.
select json_build_object(
 'answer_by_person_only',has_function_privilege('authenticated','public.answer_question(uuid,uuid,bigint,integer,text,uuid)','execute')
  and not has_function_privilege('anon','public.answer_question(uuid,uuid,bigint,integer,text,uuid)','execute')
  and not has_function_privilege('service_role','public.answer_question(uuid,uuid,bigint,integer,text,uuid)','execute')
);
