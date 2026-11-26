-- #889: where a queued turn's start stands is asked by the service role only (a send and the worker), never by a person.
select json_build_object(
 'service_asks',has_function_privilege('service_role','public.queued_turn_start(uuid,uuid)','execute'),
 'people_do_not',not has_function_privilege('authenticated','public.queued_turn_start(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.queued_turn_start(uuid,uuid)','execute'),
 'unknown_turn_waits',public.queued_turn_start(gen_random_uuid(),gen_random_uuid())='waiting'
);
