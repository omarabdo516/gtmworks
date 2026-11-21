-- #370: a change the Engine holds always gets its one row of the Company log. An Agent's memory reset (#350), one note
-- edited or forgotten (#191) and a skill written or switched (#343) are checked here, made in the Engine, and then
-- logged; until now the log was a second call that checked the Role again, so a log the database refused after the
-- Engine had changed left no row, and the person was told the change failed.
--
-- Now the check holds the change: hold_agent_change checks it exactly as before (check_memory_reset, check_memory_edit,
-- check_memory_forget, check_skill_write, as the signed-in person) and keeps one held record naming the person, the
-- Agent, the act and the skill's name, never a note's text. When the Engine answers that it holds the change,
-- finish_agent_change turns that record into its one row of the Company log and removes it in one statement: it checks
-- no Role again (the change was allowed when it was held), and a second call finds no record and writes nothing, so a
-- retry never makes two rows. When the Engine refuses, drop_agent_change removes the record and nothing is logged. The
-- app keeps trying either for ten minutes. A record still held after fifteen has an outcome nobody confirmed (the app
-- stopped, the Engine's answer never came, or the database did not answer for that long): the worker's pass
-- (finish_held_agent_changes) writes its one row marked unconfirmed, so the log is never silent about a change the
-- Engine may hold and never says one was made when nobody saw it made.
--
-- The previous app version keeps calling the check and log functions it knows (20270214000000, 20270225000000,
-- 20270226000000); they are unchanged.

create table public.held_agent_changes (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 -- No reference to the Agent: an Agent removed while its change is held still gets that change's row, as the log keeps
 -- rows of removed Agents, and the hold never stops the removal.
 agent_id uuid not null,
 actor_id uuid not null,
 act text not null check (act in ('memory_reset','memory_edit','memory_forget','skill_written','skill_enabled','skill_disabled')),
 skill text check (skill ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 held_at timestamptz not null default now(),
 check ((act like 'skill_%')=(skill is not null))
);
create index held_agent_changes_oldest on public.held_agent_changes(held_at);
alter table public.held_agent_changes enable row level security;
revoke all on public.held_agent_changes from public,anon,authenticated,service_role;

-- The change checked as its own check does, then held for the signed-in person. `note` is the memory note's id (edit,
-- forget) and `body` the skill's text (a write): both are checked and neither is kept. Answers the held record's id.
create function public.hold_agent_change(c uuid, agent uuid, act text, skill text, note text, body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare held uuid;
begin
 if act='memory_reset' then perform public.check_memory_reset(c,agent);
 elsif act='memory_edit' then perform public.check_memory_edit(c,agent,note);
 elsif act='memory_forget' then perform public.check_memory_forget(c,agent,note);
 elsif act in ('skill_written','skill_enabled','skill_disabled') then
  perform public.check_skill_write(c,agent,body);
  if skill is null or skill !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'skillInvalid' using errcode='22023'; end if;
 else raise exception 'changeInvalid' using errcode='22023'; end if;
 insert into public.held_agent_changes(company_id,agent_id,actor_id,act,skill)
  values(c,agent,auth.uid(),act,case when act like 'skill_%' then skill end) returning id into held;
 return held;
end $$;
revoke all on function public.hold_agent_change(uuid,uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.hold_agent_change(uuid,uuid,text,text,text,text) to authenticated;

-- One held record as its row of the Company log: who, the Agent, the act and a skill's name, nothing of a note, and
-- whether the Engine's answer confirmed it. The row is dated when the change was held, a moment before the Engine was
-- asked, so one logged late still reads in its place. The row is the one log_agent_event writes, with that time.
create function public.log_held_change(held public.held_agent_changes, confirmed boolean) returns void
language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(held.company_id,held.actor_id,public.log_actor_kind(held.company_id,held.actor_id),(select name from public.people where id=held.actor_id),
   'agent',held.agent_id,public.log_agent_action(held.act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=held.agent_id),'skill',held.skill,
    'unconfirmed',case when not confirmed then true end)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),held.held_at);
$$;
revoke all on function public.log_held_change(public.held_agent_changes,boolean) from public,anon,authenticated,service_role;

-- The Engine answered that it holds the change the signed-in person held: its one row of the Company log, the record
-- gone in the same statement. Answers false for a record already logged (a retry, or the worker's pass), so a change is never logged twice.
create function public.finish_agent_change(change uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare held public.held_agent_changes;
begin
 delete from public.held_agent_changes h where h.id=change and h.actor_id=auth.uid() returning h.* into held;
 if held.id is null then return false; end if;
 perform public.log_held_change(held,true);
 return true;
end $$;
revoke all on function public.finish_agent_change(uuid) from public,anon,service_role;
grant execute on function public.finish_agent_change(uuid) to authenticated;

-- The Engine refused the change: its held record goes, and nothing is logged.
create function public.drop_agent_change(change uuid) returns void
language sql security definer set search_path='' as $$
 delete from public.held_agent_changes h where h.id=change and h.actor_id=auth.uid();
$$;
revoke all on function public.drop_agent_change(uuid) from public,anon,service_role;
grant execute on function public.drop_agent_change(uuid) to authenticated;

-- The worker's pass: every record held fifteen minutes or more, past the app's own ten minutes of trying, is logged once
-- as unconfirmed and removed, each on its own, so one the log refuses stays held with a warning and never stops the
-- others. Answers how many were logged.
create function public.finish_held_agent_changes() returns integer
language plpgsql security definer set search_path='' as $$
declare change uuid; held public.held_agent_changes; logged integer:=0;
begin
 for change in select o.id from public.held_agent_changes o where o.held_at<=now()-interval '15 minutes' order by o.held_at limit 100 loop
  begin
   delete from public.held_agent_changes h where h.id=change returning h.* into held;
   if held.id is not null then
    perform public.log_held_change(held,false);
    logged:=logged+1;
   end if;
  exception when others then
   raise warning 'held agent change % not logged: %',change,sqlerrm;
  end;
 end loop;
 return logged;
end $$;
revoke all on function public.finish_held_agent_changes() from public,anon,authenticated,service_role;
grant execute on function public.finish_held_agent_changes() to service_role;
