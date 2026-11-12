create type public.member_agent_role as enum ('account_manager','writer','designer','critic');
alter table public.members add column agent_role public.member_agent_role;
alter table public.members add constraint members_agent_role_check check (
 agent_role is null or role='contributor'
);
create unique index members_active_agent_role on public.members(company_id,agent_role) where agent_role is not null and removed_at is null;

-- Resolve legacy display names once; later renames never change the role key.
update public.members m set agent_role=case
 when p.name in ('مدير الحساب','Hermes') then 'account_manager'
 when p.name in ('الكاتب','وكيل المحتوى') then 'writer'
 when p.name='المصمم' then 'designer'
 when p.name='الناقد' then 'critic'
end::public.member_agent_role
from public.people p where p.id=m.person_id and m.role='contributor'
 and p.name in ('مدير الحساب','Hermes','الكاتب','وكيل المحتوى','المصمم','الناقد');

-- Existing table grants and RLS cover this column; audit_member snapshots whole rows.
