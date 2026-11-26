-- #703, spec #695: no function that decides mentions, channels, a Conversation's addressee or the log's actor kind asks
-- whether a member is a legacy role agent, and no active member is one: no active membership holds a role key, and none
-- belongs to an identity that never signed in and was a role agent. Holds before the cutover and after it.
select json_build_object(
 'readers_know_no_role_agent',(select bool_and(position('agent_role' in pg_get_functiondef(f))=0 and pg_get_functiondef(f) !~ 'public\.agents\M')
  from unnest(array['public.log_actor_kind(uuid,uuid)','public.log_member_details(text,jsonb,jsonb)','public.conversation_addressee(uuid,text)',
   'public.note_mentions()','public.channel_person(uuid,uuid)','public.channel_message_mentions(uuid,uuid,text)',
   'public.create_card_request(uuid,text,uuid,text)']::regprocedure[]) f),
 'a_request_goes_to_a_company_agent',position('hermes_agents' in pg_get_functiondef('public.create_card_request(uuid,text,uuid,text)'::regprocedure))>0
  and position('company_agents' in pg_get_functiondef('public.create_card_request(uuid,text,uuid,text)'::regprocedure))=0,
 'a_person_is_a_person',pg_get_functiondef('public.log_actor_kind(uuid,uuid)'::regprocedure) like '%else ''person''%',
 'no_active_role_key',not exists(select 1 from public.members m where m.removed_at is null and to_jsonb(m)->>'agent_role' is not null),
 -- The cutover drops the table, so it is read only while it is there.
 'no_active_role_agent',case when to_regclass('public.agents') is null then true else (xpath('/row/n/text()',
  query_to_xml('select count(*) as n from public.members m join public.agents a on a.id=m.person_id where m.removed_at is null',false,true,'')))[1]::text='0' end
);
