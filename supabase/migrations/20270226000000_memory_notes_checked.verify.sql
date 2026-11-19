-- An Agent's note is edited by the Owner or a Manager and forgotten by the Owner alone, and each change is one row of
-- the Company log, with nothing of the note.
select json_build_object(
 'edit_for_members',has_function_privilege('authenticated','public.check_memory_edit(uuid,uuid,text)','execute'),
 'forget_for_members',has_function_privilege('authenticated','public.check_memory_forget(uuid,uuid,text)','execute'),
 'log_edit_for_members',has_function_privilege('authenticated','public.log_memory_edit(uuid,uuid)','execute'),
 'log_forget_for_members',has_function_privilege('authenticated','public.log_memory_forget(uuid,uuid)','execute'),
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute')
);
