-- #141: the tool calls the Engine reported for a Run of a Conversation, read from the Run's event stream. One row per
-- Run: the worker's follower writes what it read while the Run is open (note_run_steps), and the closer seals it in the
-- pass that closes the Run as completed (seal_run_steps), after which nothing changes. `read_to` is the highest event
-- number read, so a read again from an earlier number adds nothing twice; `broken` marks a Run whose events were lost
-- before they were read, whose steps are never shown; `ended` says the Run's own end was read, with its length in
-- `seconds` when the Engine gave one, so the closer seals what is kept without asking the Engine again. Only the service role writes, through these functions, and whoever
-- reads the Conversation reads its steps.
--
-- Nothing existing is rewritten. The previous app version runs against this: it never reads or writes the table.

-- A step is the call's id, the tool's name, the Engine's preview of the call (none when the driver dropped it) and how
-- the call stands. The list is in the Engine's order.
create function public.run_steps_valid(steps jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case when jsonb_typeof(steps)='array' then jsonb_array_length(steps)<=1000
  and not exists(select 1 from jsonb_array_elements(steps) s where not case when jsonb_typeof(s)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(s) k)=array['call','preview','state','tool']
   and jsonb_typeof(s->'call')='string' and length(s->>'call') between 1 and 200
   and jsonb_typeof(s->'tool')='string' and length(s->>'tool') between 1 and 64
   and (jsonb_typeof(s->'preview')='null' or jsonb_typeof(s->'preview')='string' and length(s->>'preview') between 1 and 300)
   and jsonb_typeof(s->'state')='string' and s->>'state' in ('started','done','failed')
  else false end)
 else false end,false);
$$;
revoke all on function public.run_steps_valid(jsonb) from public,anon,authenticated,service_role;

create table public.conversation_run_steps (
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 steps jsonb not null default '[]' check (public.run_steps_valid(steps)),
 read_to integer not null default -1 check (read_to>=-1),
 broken boolean not null default false,
 ended boolean not null default false,
 seconds integer check (seconds>=0),
 sealed_at timestamptz,
 primary key (conversation_id,run_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id)
);
alter table public.conversation_run_steps enable row level security;
create policy conversation_run_steps_read on public.conversation_run_steps for select to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_run_steps.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.conversation_run_steps from anon,authenticated,service_role;
grant select on public.conversation_run_steps to authenticated;

-- What a closer or a follower starts from: the steps read so far, the last event number read, whether events were lost,
-- whether the Run's end was read and its length, and whether the steps are sealed. No row: nothing was read yet.
create function public.run_steps_progress(conversation uuid, run text) returns table(steps jsonb, read_to integer, broken boolean, ended boolean, seconds integer, sealed boolean)
language sql stable security definer set search_path='' as $$
 select s.steps,s.read_to,s.broken,s.ended,s.seconds,s.sealed_at is not null from public.conversation_run_steps s where s.conversation_id=conversation and s.run_id=run;
$$;
revoke all on function public.run_steps_progress(uuid,text) from public,anon,authenticated;
grant execute on function public.run_steps_progress(uuid,text) to service_role;

-- Keeps what a read showed, for a Run of this Conversation (its person's message names it) that is still open (no
-- conversation_usage row) and not sealed; otherwise nothing changes and the answer is false. A read that went no further
-- than the one stored keeps the stored steps: the event number only grows, and a loss and a read end are never
-- forgotten, nor a length once known. Sealing seals the row, once.
create function public.keep_run_steps(conversation uuid, run text, noted jsonb, upto integer, lost boolean, done boolean, took integer, sealing boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare company uuid;
begin
 select m.company_id into company from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run;
 if company is null or exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=run) then return false; end if;
 insert into public.conversation_run_steps as s (company_id,conversation_id,run_id,steps,read_to,broken,ended,seconds,sealed_at)
  values (company,conversation,run,noted,upto,lost,done,took,case when sealing then now() end)
 on conflict (conversation_id,run_id) do update set steps=case when excluded.read_to>=s.read_to then excluded.steps else s.steps end,
  read_to=greatest(s.read_to,excluded.read_to),broken=s.broken or excluded.broken,ended=s.ended or excluded.ended,
  seconds=coalesce(excluded.seconds,s.seconds),sealed_at=excluded.sealed_at
  where s.sealed_at is null;
 return found;
end;
$$;
revoke all on function public.keep_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer,boolean) from public,anon,authenticated,service_role;

create function public.note_run_steps(conversation uuid, run text, noted jsonb, upto integer, lost boolean, done boolean default false, took integer default null) returns boolean
language sql security definer set search_path='' as $$
 select public.keep_run_steps(conversation,run,noted,upto,lost,coalesce(done,false),took,false);
$$;
revoke all on function public.note_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.note_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer) to service_role;

create function public.seal_run_steps(conversation uuid, run text, noted jsonb, upto integer, lost boolean, took integer) returns boolean
language sql security definer set search_path='' as $$
 select public.keep_run_steps(conversation,run,noted,upto,lost,false,took,true);
$$;
revoke all on function public.seal_run_steps(uuid,text,jsonb,integer,boolean,integer) from public,anon,authenticated;
grant execute on function public.seal_run_steps(uuid,text,jsonb,integer,boolean,integer) to service_role;
