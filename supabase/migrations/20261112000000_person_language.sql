alter table public.people add column language text not null default 'en' check (language in ('en','ar'));
-- Account preferences cannot grant a person permission to edit other profile fields.
create function public.set_language(chosen_language text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 update public.people set language=chosen_language where id=auth.uid();
 if not found then raise exception 'person not found'; end if;
end $$;
revoke all on function public.set_language(text) from public, anon;
grant execute on function public.set_language(text) to authenticated;
