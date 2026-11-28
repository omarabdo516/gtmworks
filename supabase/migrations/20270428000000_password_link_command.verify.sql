-- #955: the server is the one maker of a password link for a Company's last Administrator and for the install owner's
-- own account: only the server calls it, it names an active Administrator of the Company, and a link it makes has no
-- Person as its maker. Spending asks no maker's authority for that link, while a Team-page link on the install owner's
-- account is still refused.
select json_build_object(
 'server_alone_makes',has_function_privilege('service_role','public.make_administrator_password_link(uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.make_administrator_password_link(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.make_administrator_password_link(uuid,uuid,text)','execute'),
 'administrator_of_that_company',position($$m.role='owner'$$ in pg_get_functiondef('public.make_administrator_password_link(uuid,uuid,text)'::regprocedure))>0,
 'server_link_has_no_maker',position($$values(c,'password',link_hash,null,person$$ in pg_get_functiondef('public.make_administrator_password_link(uuid,uuid,text)'::regprocedure))>0,
 'server_link_spends_on_the_install_owner',position('link.made_by is not null' in pg_get_functiondef('public.claim_password_link(text)'::regprocedure))>0
  and position('install_owner' in pg_get_functiondef('public.claim_password_link(text)'::regprocedure))>0,
 'maker_still_checked',position('password_link_allowed(link.made_by,link.person_id)' in pg_get_functiondef('public.claim_password_link(text)'::regprocedure))>0
);
