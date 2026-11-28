-- #951: an Administrator lists and cancels the Company's pending Invite links, a cancel touches only a link still unused
-- and not cancelled, the list holds only links still waiting, and cancelling is written in the Company log.
select json_build_object(
 'administrator_lists',has_function_privilege('authenticated','public.pending_invite_links(uuid)','execute')
  and not has_function_privilege('anon','public.pending_invite_links(uuid)','execute')
  and position('is_company_owner' in pg_get_functiondef('public.pending_invite_links(uuid)'::regprocedure))>0,
 'administrator_cancels',has_function_privilege('authenticated','public.cancel_invite_link(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.cancel_invite_link(uuid,uuid)','execute')
  and position('is_company_owner' in pg_get_functiondef('public.cancel_invite_link(uuid,uuid)'::regprocedure))>0,
 'list_holds_waiting_links',position('l.used_at is null and l.cancelled_at is null and l.ends_at>now()' in pg_get_functiondef('public.pending_invite_links(uuid)'::regprocedure))>0,
 'cancel_touches_live_links_only',position('used_at is null and cancelled_at is null' in pg_get_functiondef('public.cancel_invite_link(uuid,uuid)'::regprocedure))>0,
 'cancel_logged',position('invite_link_cancelled' in pg_get_functiondef('public.cancel_invite_link(uuid,uuid)'::regprocedure))>0
);
