-- #954, ADR 0019: a Member who forgot their password gets back in through a password link an Administrator or a
-- Manager of their Company makes from the Team page; the install sends no reset email. It is the second kind of the one
-- link table (20270423000000_invite_links.sql): its secret after `#` in the address, only its hash stored, in a table
-- only server code reads. It names the Member it is for, works once and ends after 24 hours, as the reset email did. An
-- Administrator makes one for any Member; a Manager for a Manager, a Contributor or a Viewer, never an Administrator, so
-- a Manager cannot take over an Administrator's account. Opening the page uses nothing; only sending its form claims it,
-- in one transaction that locks it, finds it unused, not cancelled and not ended, ends every session of the Member and
-- marks it used. Making, replacing (a newer link cancels the earlier) and using one are written in the Company log.
-- Additive: one column, a wider kind list and four functions. The previous app version runs against it unchanged.
alter table public.company_links add column person_id uuid references public.people(id) on delete cascade;
alter table public.company_links drop constraint company_links_kind_check;
alter table public.company_links add constraint company_links_kind_check check (kind in ('invite','password'));
-- A password link is for one Member and gives no Role: whose password it sets is the only thing it carries.
alter table public.company_links add constraint company_links_password_check check (kind<>'password' or (person_id is not null and role is null and label is null));

-- A password is one for all of a Person's Companies, so a password link lets its holder into every one of them. Its
-- maker must therefore have that authority in each Company the Member is in: an active Administrator there, or an active
-- Manager there when the Member is not an Administrator there. A Manager of one Company never reaches, through a
-- Contributor of theirs, a Company where that Person is an Administrator or where the Manager is no Member at all. Only
-- the functions below ask it.
create function public.password_link_allowed(maker uuid, person uuid) returns boolean
language sql stable security definer set search_path='' as $function$
 select exists(select 1 from public.members t where t.person_id=person and t.removed_at is null)
  and not exists(select 1 from public.members t where t.person_id=person and t.removed_at is null
   and not exists(select 1 from public.members m where m.company_id=t.company_id and m.person_id=maker and m.removed_at is null
    and (m.role='owner' or (m.role='manager' and t.role<>'owner'))));
$function$;
revoke all on function public.password_link_allowed(uuid,uuid) from public,anon,authenticated,service_role;

-- The Administrator's or Manager's password link for a Member of their Company. The server makes the secret and sends
-- only its hash with the maker's own session, so this function checks who asks: an Administrator for any active Member,
-- a Manager for one who is not an Administrator, in every Company the Member is in (password_link_allowed). A Member has
-- one live password link at a time, whichever Company made it: a new one ends the earlier ones, so a link sent to the
-- wrong chat stops working as soon as the right one is made. The Person's row is locked first, so two links made at the
-- same moment are made one after the other and the second ends the first. Returns the link's id.
create function public.make_password_link(c uuid, person uuid, link_hash text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare made uuid; asker public.member_role; named text;
begin
 select m.role into asker from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null;
 if c is null or asker is null or asker not in ('owner','manager') then raise exception 'passwordLinkNotAllowed' using errcode='42501'; end if;
 if person is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null) then
  raise exception 'memberNotFound' using errcode='P0002';
 end if;
 if not public.password_link_allowed(auth.uid(),person) then raise exception 'passwordLinkNotAllowed' using errcode='42501'; end if;
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='22023'; end if;
 select p.name into named from public.people p where p.id=person for update;
 -- Each earlier live link it ends is written in its own Company's log as cancelled.
 with ended as (update public.company_links set cancelled_at=now()
  where kind='password' and person_id=person and used_at is null and cancelled_at is null and ends_at>now() returning company_id)
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  select ended.company_id,auth.uid(),public.log_actor_kind(ended.company_id,auth.uid()),(select name from public.people where id=auth.uid()),'member',person,'password_link_cancelled',
   jsonb_build_object('person_name',named,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now() from ended;
 insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at)
  values(c,'password',link_hash,auth.uid(),person,now()+interval '24 hours') returning id into made;
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
-- second waits and then finds it used. The Member must still be one of the Company, and its maker must still have the
-- authority password_link_allowed asks in every Company the Member is in, so a link made before a Role or a membership
-- changed gives no more than its maker may now.
-- Every session of the Member ends here (their refresh tokens go with them), so a lost device loses access; the server
-- then sets the new password and signs this browser in. Returns the Member, their email and the Company's slug.
create function public.claim_password_link(link_hash text) returns table(person uuid, email text, slug text)
language plpgsql security definer set search_path='' as $function$
declare link public.company_links; named text;
begin
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='55000'; end if;
 select l.* into link from public.company_links l where l.secret_hash=link_hash and l.kind='password' for update;
 if not found or link.used_at is not null then raise exception 'passwordLinkUsed' using errcode='55000'; end if;
 if link.cancelled_at is not null then raise exception 'passwordLinkCancelled' using errcode='55000'; end if;
 if link.ends_at<=now() then raise exception 'passwordLinkEnded' using errcode='55000'; end if;
 if not exists(select 1 from public.members m where m.company_id=link.company_id and m.person_id=link.person_id and m.removed_at is null)
  or not public.password_link_allowed(link.made_by,link.person_id) then
  raise exception 'passwordLinkEnded' using errcode='55000';
 end if;
 update public.company_links set used_at=now(),used_by=link.person_id where id=link.id;
 delete from auth.sessions s where s.user_id=link.person_id;
 select p.name into named from public.people p where p.id=link.person_id;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(link.company_id,link.person_id,'person',named,'member',link.person_id,'password_link_used',
   jsonb_build_object('person_name',named,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
 return query select link.person_id,u.email::text,c.slug from auth.users u, public.companies c where u.id=link.person_id and c.id=link.company_id;
end $function$;
revoke all on function public.claim_password_link(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_password_link(text) to service_role;
