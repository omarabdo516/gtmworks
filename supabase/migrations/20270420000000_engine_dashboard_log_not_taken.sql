-- #873 (spec #866), from the review of #889: every change request on the Owner's Engine dashboard is a line of the Company
-- log, the ones the Engine did not take too ('rejected': the same page and kind as a change, and the line says it was not
-- taken), and a refused action names the dashboard's page it was asked on when one is known. The words a line may carry
-- are still lib/engine-dashboard-words.mjs's alone (tests/engine-dashboard-words.test.mjs holds the two lists together).
-- Additive: one more act and an optional page on a refusal; every line the previous version writes is still accepted.

create or replace function public.log_engine_dashboard(c uuid, act text, page text, kind text) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := auth.uid();
begin
 if me is null or not public.is_company_owner(c) then raise exception 'engineDashboardNotAllowed' using errcode='42501'; end if;
 if page is not null and page not in ('keys','config','plugins','mcp','channels','webhooks','pairing','cron','skills','models','profiles','files','system','sessions','kanban') then
  raise exception 'engineDashboardLineUnknown' using errcode='22023';
 end if;
 if act='opened' and page is null and kind is null then
  -- Two first pages loaded at once are still one visit.
  perform pg_advisory_xact_lock(hashtextextended('engine_dashboard_opened '||c::text||' '||me::text,0));
  if exists(select 1 from public.company_log l where l.company_id=c and l.source='engine_dashboard' and l.action='engine_dashboard_opened'
   and l.actor_id=me and l.created_at>now()-interval '30 minutes') then return; end if;
 elsif act in ('changed','rejected') and kind in ('keySaved','keyRemoved','pluginInstalled','platformSet','platformConnected','settingSaved','added','removed','changed') then
  null;
 elsif act='refused' and kind in ('engineKey','hermesUpdate','backupImport','agentProfile') then
  null;
 else raise exception 'engineDashboardLineUnknown' using errcode='22023';
 end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(c,me,public.log_actor_kind(c,me),(select name from public.people where id=me),'company','engine_dashboard_'||act,
   case act when 'refused' then jsonb_strip_nulls(jsonb_build_object('page',page,'refused',kind))
    when 'opened' then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object('page',page,'change',kind)) end
    ||jsonb_build_object('private','owners'),
   'engine_dashboard',nextval('public.engine_dashboard_log_ids'),now());
end $$;
revoke all on function public.log_engine_dashboard(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.log_engine_dashboard(uuid,text,text,text) to authenticated;
