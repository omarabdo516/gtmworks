-- #952: an Administrator reads the people they may add without a link and adds one, a signed-in person's membership of
-- the Company behind an open Invite link is the server's question alone, and the claim names an account that has no
-- Person row from its email.
select json_build_object(
 'administrator_reads_and_adds',(select bool_and(has_function_privilege('authenticated',fn,'execute') and not has_function_privilege('anon',fn,'execute') and not has_function_privilege('service_role',fn,'execute'))
  from unnest(array['public.company_addable_people(uuid)','public.add_company_member(uuid,uuid,text,uuid[])']) fn),
 'server_asks_membership',has_function_privilege('service_role','public.invite_link_member(text,uuid)','execute')
  and not has_function_privilege('authenticated','public.invite_link_member(text,uuid)','execute')
  and not has_function_privilege('anon','public.invite_link_member(text,uuid)','execute'),
 'add_checks_the_administrator_and_the_other_company',pg_get_functiondef('public.add_company_member(uuid,uuid,text,uuid[])'::regprocedure) like '%is_company_owner%'
  and pg_get_functiondef('public.add_company_member(uuid,uuid,text,uuid[])'::regprocedure) like '%memberNotFromAdminCompany%'
  and pg_get_functiondef('public.add_company_member(uuid,uuid,text,uuid[])'::regprocedure) !~ 'member_role in [^;]*owner',
 'read_checks_the_administrator',pg_get_functiondef('public.company_addable_people(uuid)'::regprocedure) like '%is_company_owner(c)%'
  and pg_get_functiondef('public.company_addable_people(uuid)'::regprocedure) like '%not exists%',
 'claim_names_an_account_without_a_person_row',position('split_part(u.email' in pg_get_functiondef('public.claim_invite_link(text,uuid,text,text)'::regprocedure))>0
);
