-- #951, ADR 0019: an Administrator sees the Invite links still waiting for their Person, and cancels one before it is
-- used. Both read the link table no Member reads (20270423000000_invite_links.sql), through security definer functions
-- that check the Administrator again: only an Administrator of the Company lists or cancels its links. A cancelled
-- link is refused by claim_invite_link, which already checks cancelled_at, and cancelling is written in the Company log.
-- Additive: two functions and one action the log now holds. The previous app version runs against it unchanged.

-- The links still waiting: unused, not cancelled and not past their 7 days, with who made each. An Administrator reads
-- them for the Team table; anyone else is refused. A link used, cancelled or ended between this read and the press on
-- Cancel simply updates no row, so it is never cancelled twice nor logged twice.
create function public.pending_invite_links(c uuid) returns table(id uuid, label text, role text, made_by_name text, ends_at timestamptz)
language plpgsql stable security definer set search_path='' as $function$
begin
 if c is null or not public.is_company_owner(c) then raise exception 'inviteLinkNotAllowed' using errcode='42501'; end if;
 return query select l.id,l.label,l.role,p.name,l.ends_at
  from public.company_links l left join public.people p on p.id=l.made_by
  where l.company_id=c and l.kind='invite' and l.used_at is null and l.cancelled_at is null and l.ends_at>now()
  order by l.created_at;
end $function$;
revoke all on function public.pending_invite_links(uuid) from public,anon,service_role;
grant execute on function public.pending_invite_links(uuid) to authenticated;

-- Cancel stops a link at once: one statement marks the row cancelled, touching only a link still unused and not
-- cancelled, so a link spent by a Person or cancelled by another Administrator at the same moment waits and then finds
-- nothing to do. Cancelling is in the Company log with the link's label and Role, by the Administrator who stopped it.
create function public.cancel_invite_link(c uuid, link uuid) returns void
language plpgsql security definer set search_path='' as $function$
declare stopped public.company_links;
begin
 if c is null or not public.is_company_owner(c) then raise exception 'inviteLinkNotAllowed' using errcode='42501'; end if;
 update public.company_links set cancelled_at=now()
  where id=link and company_id=c and kind='invite' and used_at is null and cancelled_at is null
  returning * into stopped;
 if not found then return; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'member','invite_link_cancelled',
   jsonb_build_object('label',stopped.label,'role',stopped.role,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
end $function$;
revoke all on function public.cancel_invite_link(uuid,uuid) from public,anon,service_role;
grant execute on function public.cancel_invite_link(uuid,uuid) to authenticated;
