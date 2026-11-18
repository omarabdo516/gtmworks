begin;
create extension if not exists pgtap with schema extensions;
-- What each Role may do in its own Company, proven at the database (#337). One member of RS Learning holds each Role in
-- turn and tries every action below; each action names the Roles that may take it, and every other Role must be refused.
-- Every Role of member_role must appear, with at least one action it may take and one it may not.
create temp table role_matrix(action text primary key, statement text not null, allowed text[] not null);
insert into role_matrix values
 ('read the board',
  $$select count(*) > 0 from public.work_cards where company_id = '10000000-0000-0000-0000-000000000001'$$,
  '{owner,manager,contributor,viewer}'),
 ('read the Company''s members',
  $$select count(*) > 1 from public.members where company_id = '10000000-0000-0000-0000-000000000001'$$,
  '{owner,manager,contributor,viewer}'),
 ('set their own language',
  $$select true from public.set_language('ar')$$,
  '{owner,manager,contributor,viewer}'),
 ('create a card',
  $$select public.create_work_card('10000000-0000-0000-0000-000000000001',
    (select min(id) from public.work_stages where company_id = '10000000-0000-0000-0000-000000000001'), 'Role matrix') is not null$$,
  '{owner,manager,contributor}'),
 ('change a card',
  $$with changed as (update public.work_cards set title = title where company_id = '10000000-0000-0000-0000-000000000001' returning 1)
    select count(*) > 0 from changed$$,
  '{owner,manager,contributor}'),
 ('save an approval step',
  $$select true from public.save_approval_step('10000000-0000-0000-0000-000000000001', null, 'Role matrix', 99, null, 'manager')$$,
  '{owner,manager}'),
 ('remove a member',
  $$select true from public.remove_member('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005')$$,
  '{owner,manager}'),
 ('invite a member',
  $$select public.invite_member('10000000-0000-0000-0000-000000000001', 'role-matrix-invite@example.test', 'contributor') is not null$$,
  '{owner}'),
 ('rename the Company',
  $$select public.rename_company('10000000-0000-0000-0000-000000000001', 'RS Learning') is not null$$,
  '{owner}'),
 ('change what a Role may do',
  $$with changed as (update public.role_permissions set allowed = true where company_id = '10000000-0000-0000-0000-000000000001' returning 1)
    select count(*) > 0 from changed$$,
  '{}');

create temp table roles_tried(role text, action text, got boolean, why text);
insert into auth.users(id,email) values ('e3370000-0000-0000-0000-000000000010','role-matrix@example.test');
insert into public.people(id,name) values ('e3370000-0000-0000-0000-000000000010','Holds each Role');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000001','e3370000-0000-0000-0000-000000000010','viewer');

-- Each action runs as the member and is rolled back after, so no action sees another's changes. An action works when it
-- answers true; one that answers false or is refused does not.
do $$
declare r text; m record; got boolean; why text;
begin
 for r in select unnest(enum_range(null::public.member_role))::text loop
  update public.members set role = r::public.member_role
   where company_id = '10000000-0000-0000-0000-000000000001' and person_id = 'e3370000-0000-0000-0000-000000000010';
  for m in select * from role_matrix loop
   got := false; why := null;
   begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', 'e3370000-0000-0000-0000-000000000010', true);
    execute m.statement into got;
    raise exception using errcode = 'P0337';
   exception when sqlstate 'P0337' then null;
    when others then got := false; why := sqlstate || ' ' || sqlerrm;
   end;
   insert into roles_tried values (r, m.action, coalesce(got, false), why);
  end loop;
 end loop;
end $$;

select plan((select 3 + 2 * count(*)::int + count(*)::int * (select count(*)::int from role_matrix) from unnest(enum_range(null::public.member_role))));
select set_eq($$select unnest(enum_range(null::public.member_role))::text$$, $$select distinct role from roles_tried$$,
 'the role matrix tries every Role');
select ok((select bool_and(r::text = any(enum_range(null::public.member_role)::text[])) from role_matrix, unnest(allowed) r),
 'the role matrix names only real Roles');
select is((select count(*)::int from roles_tried),
 (select count(*)::int from role_matrix) * cardinality(enum_range(null::public.member_role)), 'every Role tried every action');
select ok(exists (select 1 from role_matrix where e.role = any(allowed)), format('the matrix names an action %s may take', initcap(e.role)))
from unnest(enum_range(null::public.member_role)::text[]) e(role);
select ok(exists (select 1 from role_matrix where not e.role = any(allowed)), format('the matrix names an action %s may not take', initcap(e.role)))
from unnest(enum_range(null::public.member_role)::text[]) e(role);
select is(t.got, t.role = any(m.allowed),
 format('%s %s %s', initcap(t.role), case when t.role = any(m.allowed) then 'may' else 'may not' end, m.action))
from roles_tried t join role_matrix m using (action)
order by array_position(enum_range(null::public.member_role)::text[], t.role), m.action;
-- Why an action a Role may take was refused.
select diag(format('%s, %s: %s', t.role, t.action, t.why))
from roles_tried t join role_matrix m using (action) where t.role = any(m.allowed) and t.why is not null;

select * from finish();
rollback;
