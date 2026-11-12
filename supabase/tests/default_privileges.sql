begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- List offenders so an unsafe migration is actionable, even without any grants.
select is_empty($$
 select format('%I.%I', n.nspname, c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
 order by c.relname
$$, 'every migrated public table requires RLS');

select is_empty($$
 select format('%I.%I', n.nspname, c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v'
  and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
  and not coalesce(c.reloptions @> array['security_invoker=true'], false)
 order by c.relname
$$, 'client-accessible views must preserve the caller''s RLS');

-- New objects receive no client access until a migration deliberately grants it.
create table public.ci_private_table (company_id uuid);
insert into public.ci_private_table values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003');
create view public.ci_private_view with (security_invoker=true) as
 select company_id from public.ci_private_table;
create sequence public.ci_private_sequence;
create function public.ci_private_function() returns integer language sql as $$ select 7 $$;

select is_empty($$
 select role_name, object_name from (values ('anon'), ('authenticated')) roles(role_name)
 cross join (values ('public.ci_private_table'), ('public.ci_private_view')) objects(object_name)
 where has_table_privilege(role_name, object_name, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
 union all
 select role_name, 'public.ci_private_sequence' from (values ('anon'), ('authenticated')) roles(role_name)
 where has_sequence_privilege(role_name, 'public.ci_private_sequence', 'SELECT, UPDATE, USAGE')
 union all
 select role_name, 'public.ci_private_function()' from (values ('anon'), ('authenticated')) roles(role_name)
 where has_function_privilege(role_name, 'public.ci_private_function()', 'EXECUTE')
$$, 'new objects inherit no client privileges, including TRUNCATE and sequence SELECT');

set local role anon;
select throws_ok('select * from public.ci_private_table', '42501', 'permission denied for table ci_private_table', 'anon cannot reach a new table');
select throws_ok('select * from public.ci_private_view', '42501', 'permission denied for view ci_private_view', 'anon cannot reach a new view');
select throws_ok('select nextval(''public.ci_private_sequence'')', '42501', 'permission denied for sequence ci_private_sequence', 'anon cannot use a new sequence');
select throws_ok('select public.ci_private_function()', '42501', 'permission denied for function ci_private_function', 'anon cannot execute a new function');
reset role;

set local role authenticated;
select throws_ok('select * from public.ci_private_table', '42501', 'permission denied for table ci_private_table', 'authenticated cannot reach a new table');
select throws_ok('select * from public.ci_private_view', '42501', 'permission denied for view ci_private_view', 'authenticated cannot reach a new view');
select throws_ok('select nextval(''public.ci_private_sequence'')', '42501', 'permission denied for sequence ci_private_sequence', 'authenticated cannot use a new sequence');
select throws_ok('select public.ci_private_function()', '42501', 'permission denied for function ci_private_function', 'authenticated cannot execute a new function');
reset role;

-- A migration can deliberately expose operations, with company isolation intact.
alter table public.ci_private_table enable row level security;
create policy company_read on public.ci_private_table for select to authenticated
 using (public.is_member(company_id));
grant select on public.ci_private_table, public.ci_private_view to authenticated;
grant usage on sequence public.ci_private_sequence to authenticated;
grant execute on function public.ci_private_function() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.ci_private_table), 1, 'explicit table grant allows the member''s company');
select is((select count(*)::integer from public.ci_private_table where company_id='10000000-0000-0000-0000-000000000003'), 0, 'table grant does not bypass company RLS');
select is((select count(*)::integer from public.ci_private_view), 1, 'explicit invoker view grant allows the member''s company');
select is((select count(*)::integer from public.ci_private_view where company_id='10000000-0000-0000-0000-000000000003'), 0, 'view grant does not bypass company RLS');
select is(nextval('public.ci_private_sequence'), 1::bigint, 'explicit sequence grant permits use');
select is(public.ci_private_function(), 7, 'explicit function grant permits execution');
select throws_ok('insert into public.ci_private_table values (null)', '42501', 'permission denied for table ci_private_table', 'SELECT grant does not permit INSERT');
select throws_ok('truncate public.ci_private_table', '42501', 'permission denied for table ci_private_table', 'SELECT grant does not permit TRUNCATE, which bypasses RLS');
reset role;

set local role anon;
select throws_ok('select * from public.ci_private_table', '42501', 'permission denied for table ci_private_table', 'authenticated table grant does not grant anon access');
select throws_ok('select * from public.ci_private_view', '42501', 'permission denied for view ci_private_view', 'authenticated view grant does not grant anon access');
select throws_ok('select nextval(''public.ci_private_sequence'')', '42501', 'permission denied for sequence ci_private_sequence', 'authenticated sequence grant does not grant anon access');
select throws_ok('select public.ci_private_function()', '42501', 'permission denied for function ci_private_function', 'authenticated function grant does not grant anon access');
reset role;

grant select on public.ci_private_table, public.ci_private_view to anon;
set local role anon;
select is((select count(*)::integer from public.ci_private_table), 0, 'explicit anon table grant still defaults to no rows under RLS');
select is((select count(*)::integer from public.ci_private_view), 0, 'explicit anon view grant still defaults to no rows under RLS');
reset role;
select * from finish();
rollback;
