-- #873 (spec #866): the Owner's Engine dashboard in the Company log. The Engine knows one identity for everyone who comes
-- through gtmworks's gate, so these lines are the only record of which Owner did what there: who opened it (one line a
-- visit), each change they made there with the dashboard's page and the kind of change, and each action refused there.
-- The gate writes them with the person's own session (lib/engine-dashboard-activity.mjs). A line carries only fixed
-- words (lib/engine-dashboard-words.mjs), never a key, a value or any part of a request's body: anything else is
-- refused. Only Owners read them, as only Owners open the dashboard. Additive: a new log source and one function; the
-- previous app version calls neither.

create sequence public.engine_dashboard_log_ids;
revoke all on sequence public.engine_dashboard_log_ids from public,anon,authenticated,service_role;
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in
 ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards',
  'member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies','channel_cards','channel_replies',
  'conversation_archives','channel_archives','engine_dashboard'));

-- One line of the dashboard for Company `c`, by the calling Owner: `act` is 'opened' (no page, no kind), 'changed' (a
-- kind of change, and the page when one is known) or 'refused' (which of the four, lib/engine-dashboard-refusals.mjs).
-- A visit is one line: an opening within thirty minutes of that person's last opening line in the Company writes none.
create function public.log_engine_dashboard(c uuid, act text, page text, kind text) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := auth.uid();
begin
 if me is null or not public.is_company_owner(c) then raise exception 'engineDashboardNotAllowed' using errcode='42501'; end if;
 if act='opened' and page is null and kind is null then
  -- Two first pages loaded at once are still one visit.
  perform pg_advisory_xact_lock(hashtextextended('engine_dashboard_opened '||c::text||' '||me::text,0));
  if exists(select 1 from public.company_log l where l.company_id=c and l.source='engine_dashboard' and l.action='engine_dashboard_opened'
   and l.actor_id=me and l.created_at>now()-interval '30 minutes') then return; end if;
 elsif act='changed' and kind in ('keySaved','keyRemoved','pluginInstalled','platformSet','platformConnected','settingSaved','added','removed','changed')
  and (page is null or page in ('keys','config','plugins','mcp','channels','webhooks','pairing','cron','skills','models','profiles','files','system','sessions','kanban')) then
  null;
 elsif act='refused' and page is null and kind in ('engineKey','hermesUpdate','backupImport','agentProfile') then
  null;
 else raise exception 'engineDashboardLineUnknown' using errcode='22023';
 end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(c,me,public.log_actor_kind(c,me),(select name from public.people where id=me),'company','engine_dashboard_'||act,
   case act when 'changed' then jsonb_strip_nulls(jsonb_build_object('page',page,'change',kind)) when 'refused' then jsonb_build_object('refused',kind) else '{}'::jsonb end
    ||jsonb_build_object('private','owners'),
   'engine_dashboard',nextval('public.engine_dashboard_log_ids'),now());
end $$;
revoke all on function public.log_engine_dashboard(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.log_engine_dashboard(uuid,text,text,text) to authenticated;
