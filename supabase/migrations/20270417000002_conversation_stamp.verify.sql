-- #767: a Conversation's stamp, for its person only.
select json_build_object(
 'stamp_for_people',has_function_privilege('authenticated','public.conversation_stamp(uuid)','execute')
  and not has_function_privilege('anon','public.conversation_stamp(uuid)','execute')
);
