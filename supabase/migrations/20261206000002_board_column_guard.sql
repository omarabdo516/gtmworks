-- A stage's board column is part of what the stage is (#34, ADR 0013), guarded as its kind and key are:
--  * Once a stage is made its column cannot change, so an Owner or Manager cannot show a stage before review as Live or
--    Done and let a Contributor move a card "there" while every rule still treats it as before review.
--  * A stage before review is never made in Live or Done, whoever makes it.
--  * A stage made by a signed-in Owner or Manager takes its column: the placing trigger runs as its owner, because the
--    placing function reads the Company's stages and is not open to signed-in roles.
-- No stage or card is rewritten; the previous app version never changes a stage's column.

create or replace function public.work_stage_place() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.board_column is distinct from old.board_column then raise exception 'stage identity cannot change'; end if;
  return new;
 end if;
 if new.board_column is null then new.board_column=public.work_stage_column(new.company_id,new.kind,new.stage_key,new.position); end if;
 if new.kind in ('ideas','before_review') and new.board_column in ('live','done') then raise exception 'a stage before review cannot be live or done'; end if;
 return new;
end $$;
revoke all on function public.work_stage_place() from public,anon,authenticated,service_role;
drop trigger work_stage_place on public.work_stages;
create trigger work_stage_place before insert or update on public.work_stages for each row execute function public.work_stage_place();
