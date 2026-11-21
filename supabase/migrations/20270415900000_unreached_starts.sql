-- #413: a channel or note Run's start that never reached an Engine (the Company has no Engine record yet, or its Engine
-- is not running: nothing could connect) is no attempt. begin_channel_start and begin_note_start count an attempt before
-- the Engine is known, so a request that may reach it keeps its idempotency; the driver hands the attempt back here once
-- it knows the request never left. The Run then stays due as never started, its next start is a first one again (so a
-- refusal of it fails the Run instead of reading as unknown for a day), and the never-started time limit still ends it.
-- Only the attempt that was begun is handed back: once a later attempt began, or a run id was recorded, or the Run ended,
-- nothing changes, since that later request may have reached the Engine. The previous app version never calls these.
create function public.release_channel_start(message bigint, attempt integer, ordinal smallint) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 select * into r from public.channel_runs where message_id=message and public.channel_runs.ordinal=release_channel_start.ordinal for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null or attempt is null or attempt < 1
  or r.attempts is distinct from attempt then return false; end if;
 update public.channel_runs set attempts=attempts-1,
  first_attempted_at=case when attempts=1 then null else first_attempted_at end
  where message_id=message and public.channel_runs.ordinal=r.ordinal;
 return true;
end $$;
revoke all on function public.release_channel_start(bigint,integer,smallint) from public,anon,authenticated;
grant execute on function public.release_channel_start(bigint,integer,smallint) to service_role;

create function public.release_note_start(message bigint, attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null or r.run_id is not null or attempt is null or attempt < 1
  or r.attempts is distinct from attempt then return false; end if;
 update public.note_runs set attempts=attempts-1 where note_id=message;
 return true;
end $$;
revoke all on function public.release_note_start(bigint,integer) from public,anon,authenticated;
grant execute on function public.release_note_start(bigint,integer) to service_role;
