-- The Owner renames the Company (#26). Companies have no update policy, so a signed-in person changes a name only
-- through this function, which checks that the caller is an active Owner of that Company. The name is trimmed and
-- must be 1 to 80 characters; the slug (the Company's address) never changes. Nothing else is rewritten, and the
-- previous app version, which never renames a Company, runs against this database unchanged.
create function public.rename_company(c uuid, company_name text) returns text
language plpgsql security definer set search_path='' as $$
declare cleaned text:=btrim(coalesce(company_name,''));
begin
 if not public.is_company_owner(c) then raise exception 'companyRenameNotAllowed' using errcode='42501'; end if;
 if cleaned='' or char_length(cleaned)>80 then raise exception 'companyNameInvalid' using errcode='22023'; end if;
 update public.companies set name=cleaned where id=c;
 return cleaned;
end $$;
revoke all on function public.rename_company(uuid,text) from public,anon,service_role;
grant execute on function public.rename_company(uuid,text) to authenticated;
