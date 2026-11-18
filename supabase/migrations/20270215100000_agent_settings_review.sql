-- #352's review of the settings pages: a setting log row can only name the two fields whose text this version keeps
-- outside the log (About and Voice), and never carries a value of its own. The fields are the page's own sections; a
-- Manager could otherwise write a row for any field with any old and new text. About and Voice already call with no
-- values (lib/agent-about.mjs, lib/agent-voice.mjs), so nothing the app writes changes. Additive: the function is made
-- again with the same signature, and the previous app version calls it exactly as before.
create or replace function public.log_agent_setting(c uuid, agent uuid, field text, old_value text, new_value text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_agent_setting(c,agent);
 -- A field this version has no words for is never written, and a row this page writes keeps no text: the field alone.
 if field is null or field not in ('about','voice') then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 if old_value is not null or new_value is not null then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),
   'agent',agent,'agent_setting_changed',
   jsonb_strip_nulls(jsonb_build_object(
    'agent_name',(select name from public.hermes_agents where id=agent),
    'field',field)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_agent_setting(uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.log_agent_setting(uuid,uuid,text,text,text) to authenticated;
