-- #642: a Conversation's Run that ended because every account it could use ran out (`no_access`, #622) keeps when the
-- usage resets, when the Engine's text named it, so the chat says when a send again can work. One append-only row per
-- such Run, beside its end (conversation_run_ends is append-only, so the end itself is not changed), read under the
-- same rule as the end and written only in the same transaction as the end, by the worker's closer.
create table public.conversation_run_resets (
 company_id uuid not null,
 conversation_id uuid not null,
 run_id text not null,
 resets_at timestamptz not null,
 primary key (conversation_id,run_id),
 foreign key (conversation_id,run_id) references public.conversation_run_ends(conversation_id,run_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id)
);
alter table public.conversation_run_resets enable row level security;
create policy conversation_run_resets_read on public.conversation_run_resets for select to authenticated using (exists(select 1 from public.conversations c
 where c.id=conversation_id and c.company_id=conversation_run_resets.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.conversation_run_resets from anon,authenticated,service_role;
grant select on public.conversation_run_resets to authenticated;
create trigger conversation_run_resets_append_only before update or delete on public.conversation_run_resets for each row execute function public.refuse_conversation_change();

-- The close of a Run that ran out of usage, with when it resets: the same close (close_conversation_run, unchanged, which
-- the previous app version still calls), and the reset kept only when this call closed the Run and it ended no_access.
create function public.close_conversation_run_out_of_usage(conversation uuid, run text, hermes_session text, read_completed boolean, usage_resets_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare closed boolean;
begin
 closed := public.close_conversation_run(conversation,run,'no_access',null,hermes_session,null,null,read_completed);
 if closed and usage_resets_at is not null then
  insert into public.conversation_run_resets(company_id,conversation_id,run_id,resets_at)
   select e.company_id,e.conversation_id,e.run_id,usage_resets_at from public.conversation_run_ends e
   where e.conversation_id=conversation and e.run_id=run and e.outcome='no_access';
 end if;
 return closed;
end $$;
revoke all on function public.close_conversation_run_out_of_usage(uuid,text,text,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.close_conversation_run_out_of_usage(uuid,text,text,boolean,timestamptz) to service_role;
