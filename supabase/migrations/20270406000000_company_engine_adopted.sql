-- #378 (S1), ADR 0018: an install made by the release before this one has no Engine record at all, and its one
-- Company names no Engine after the migrations run. The installer adopts the Engine that install already runs (its
-- volume, its key) as that Company's Engine, in one transaction: the record is written and the Company names it, so
-- the install never sits with a Company that has no Engine. An install this release made has every Company attached and
-- nothing is written. More than one Company cannot be adopted this way (the update refuses such an install first), so
-- the function refuses rather than put two Companies on one Engine.
create function public.adopt_engine(address text, key_encrypted text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare missing integer; engine uuid;
begin
 if address is null or length(address) not between 1 and 2048 or key_encrypted is null or length(key_encrypted)=0 then
  raise exception 'invalidEngine' using errcode='22023';
 end if;
 select count(*) into missing from public.companies c where c.engine_id is null;
 if missing=0 then return null; end if;
 if missing>1 then raise exception 'companyEngineMissing' using errcode='55000'; end if;
 insert into public.company_engines(address,key_encrypted) values(address,key_encrypted) returning id into engine;
 update public.companies set engine_id=engine where engine_id is null;
 return engine;
end $function$;
revoke all on function public.adopt_engine(text,text) from public,anon,authenticated,service_role;
grant execute on function public.adopt_engine(text,text) to service_role;
