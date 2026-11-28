-- #954, ADR 0019: a Member who forgot their password gets back in through a password link an Administrator or a
-- Manager of their Company makes from the Team page; the install sends no reset email. It is the second kind of the one
-- link table (20270423000000_invite_links.sql): its secret after `#` in the address, only its hash stored, in a table
-- only server code reads. It names the Member it is for, works once and ends after 24 hours, as the reset email did. An
-- Administrator makes one for any Member; a Manager for a Manager, a Contributor or a Viewer, never an Administrator, so
-- a Manager cannot take over an Administrator's account. Opening the page uses nothing; only sending its form claims it,
-- in one transaction that locks it, finds it unused, not cancelled and not ended, ends every session of the Member and
-- marks it used. Making and using one are written in the Company log.
-- Additive: one column, a wider kind list and three functions. The previous app version runs against it unchanged.
alter table public.company_links add column person_id uuid references public.people(id) on delete cascade;
alter table public.company_links drop constraint company_links_kind_check;
alter table public.company_links add constraint company_links_kind_check check (kind in ('invite','password'));
-- A password link is for one Member and gives no Role: whose password it sets is the only thing it carries.
alter table public.company_links add constraint company_links_password_check check (kind<>'password' or (person_id is not null and role is null and label is null));

-- The Administrator's or Manager's password link for a Member of their Company. The server makes the secret and sends
-- only its hash with the maker's own session, so this function checks who asks: an Administrator for any active Member,
-- a Manager for one who is not an Administrator. A Member has one live password link at a time: a new one ends the
-- earlier ones, so a link sent to the wrong chat stops working as soon as the right one is made. Returns the link's id.
create function public.make_password_link(c uuid, person uuid, link_hash text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare made uuid; asker public.member_role; target public.member_role; named text;
begin
 select m.role into asker from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null;
 if c is null or asker is null or asker not in ('owner','manager') then raise exception 'passwordLinkNotAllowed' using errcode='42501'; end if;
 select m.role into target from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null;
 if person is null or target is null then raise exception 'memberNotFound' using errcode='P0002'; end if;
 if target='owner' and asker<>'owner' then raise exception 'passwordLinkNotAllowed' using errcode='42501'; end if;
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='22023'; end if;
 update public.company_links set cancelled_at=now()
  where company_id=c and kind='password' and person_id=person and used_at is null and cancelled_at is null;
 insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at)
  values(c,'password',link_hash,auth.uid(),person,now()+interval '24 hours') returning id into made;
 select p.name into named from public.people p where p.id=person;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'member',person,'password_link_made',
   jsonb_build_object('person_name',named,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
 return made;
end $function$;
revoke all on function public.make_password_link(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.make_password_link(uuid,uuid,text) to authenticated;

-- Whether a password link can still be used, with the Company, the Member's name and their email, for the page to show
-- before its form (the email goes in the form for the browser's password manager). It reads and writes nothing else,
-- so opening the page (or a link preview fetching it) never uses the link up.
create function public.password_link_open(link_hash text) returns table(company text, person_name text, email text)
language sql stable security definer set search_path='' as $function$
 select c.name,p.name,u.email::text from public.company_links l
  join public.companies c on c.id=l.company_id
  join public.people p on p.id=l.person_id
  join auth.users u on u.id=l.person_id
  join public.members m on m.company_id=l.company_id and m.person_id=l.person_id and m.removed_at is null
 where l.secret_hash=link_hash and l.kind='password' and l.used_at is null and l.cancelled_at is null and l.ends_at>now();
$function$;
revoke all on function public.password_link_open(text) from public,anon,authenticated,service_role;
grant execute on function public.password_link_open(text) to service_role;

-- Sending a password link's form spends it: the link's row is locked first, so of two sends at the same moment the
-- second waits and then finds it used. The Member must still be one of the Company, and a link for an Administrator
-- still made by an active Administrator, so a link made before a Role changed gives no more than its maker may now.
-- Every session of the Member ends here (their refresh tokens go with them), so a lost device loses access; the server
-- then sets the new password and signs this browser in. Returns the Member, their email and the Company's slug.
create function public.claim_password_link(link_hash text) returns table(person uuid, email text, slug text)
language plpgsql security definer set search_path='' as $function$
declare link public.company_links; target public.member_role;
begin
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='55000'; end if;
 select l.* into link from public.company_links l where l.secret_hash=link_hash and l.kind='password' for update;
 if not found or link.used_at is not null then raise exception 'passwordLinkUsed' using errcode='55000'; end if;
 if link.cancelled_at is not null then raise exception 'passwordLinkCancelled' using errcode='55000'; end if;
 if link.ends_at<=now() then raise exception 'passwordLinkEnded' using errcode='55000'; end if;
 select m.role into target from public.members m where m.company_id=link.company_id and m.person_id=link.person_id and m.removed_at is null;
 if target is null then raise exception 'passwordLinkEnded' using errcode='55000'; end if;
 if target='owner' and not exists(select 1 from public.members m where m.company_id=link.company_id and m.person_id=link.made_by and m.removed_at is null and m.role='owner') then
  raise exception 'passwordLinkEnded' using errcode='55000';
 end if;
 update public.company_links set used_at=now(),used_by=link.person_id where id=link.id;
 delete from auth.sessions s where s.user_id=link.person_id;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(link.company_id,link.person_id,'person',(select name from public.people where id=link.person_id),'member',link.person_id,'password_link_used',
   jsonb_build_object('person_name',(select name from public.people where id=link.person_id),'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
 return query select link.person_id,u.email::text,c.slug from auth.users u, public.companies c where u.id=link.person_id and c.id=link.company_id;
end $function$;
revoke all on function public.claim_password_link(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_password_link(text) to service_role;
