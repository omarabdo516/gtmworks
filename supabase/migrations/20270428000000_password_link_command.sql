-- #955, ADR 0019: a Company's last Administrator, and the install owner, whom no Administrator may link from the Team
-- page (#915), gets a password link from the server: `gtmworks company password-link` makes it with the service role.
-- It is the password link of #954 with no Person as its maker, `made_by` null, which is what the command leaves behind.
-- Only an active Administrator of the named Company is named, a newer link for the same Person ends the earlier ones as
-- on the Team page, and making it is in the Company log as the server's act. Additive but for the claim below: the
-- previous app version makes and spends Team-page links as before.
create function public.make_administrator_password_link(c uuid, person uuid, link_hash text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare made uuid; named text;
begin
 if c is null or person is null then raise exception 'passwordLinkNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.companies co where co.id=c) then raise exception 'companyNotFound' using errcode='P0002'; end if;
 if not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null) then
  raise exception 'passwordLinkNotAdministrator' using errcode='42501';
 end if;
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='22023'; end if;
 select p.name into named from public.people p where p.id=person for update;
 -- A Member has one live password link at a time, whichever Company or command made it: a new one ends the earlier ones.
 with ended as (update public.company_links set cancelled_at=now()
  where kind='password' and person_id=person and used_at is null and cancelled_at is null and ends_at>now() returning company_id)
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  select ended.company_id,null,'system','gtmworks command','member',person,'password_link_cancelled',
   jsonb_build_object('person_name',named,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now() from ended;
 insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at)
  values(c,'password',link_hash,null,person,now()+interval '24 hours') returning id into made;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(c,null,'system','gtmworks command','member',person,'password_link_made',
   jsonb_build_object('person_name',named,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
 return made;
end $function$;
revoke all on function public.make_administrator_password_link(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.make_administrator_password_link(uuid,uuid,text) to service_role;

-- Sending a server-made link's form spends it as a Team-page link's is spent: the row is locked first, so of two sends at
-- the same moment the second waits and finds it used. A server-made link (made_by null, #955) names an Administrator of
-- its Company, its Company and the Person are still there, so it asks no maker's authority: it is how a Company's last
-- Administrator and the install owner, whose account no Team-page link may ever set, get back in. Any other link is
-- still refused for the install owner's account and once its maker no longer has the authority it was made with.
create or replace function public.claim_password_link(link_hash text) returns table(person uuid, email text, slug text)
language plpgsql security definer set search_path='' as $function$
declare link public.company_links; named text;
begin
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'passwordLinkInvalid' using errcode='55000'; end if;
 select l.* into link from public.company_links l where l.secret_hash=link_hash and l.kind='password' for update;
 if not found or link.used_at is not null then raise exception 'passwordLinkUsed' using errcode='55000'; end if;
 if link.cancelled_at is not null then raise exception 'passwordLinkCancelled' using errcode='55000'; end if;
 if link.ends_at<=now() then raise exception 'passwordLinkEnded' using errcode='55000'; end if;
 if not exists(select 1 from public.members m where m.company_id=link.company_id and m.person_id=link.person_id and m.removed_at is null)
  or (link.made_by is not null and (exists(select 1 from public.install_owner o where o.person_id=link.person_id)
   or not public.password_link_allowed(link.made_by,link.person_id))) then
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
