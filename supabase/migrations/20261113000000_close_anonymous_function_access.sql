-- PUBLIC revokes leave Supabase's direct default grants to anon intact.
revoke execute on function public.is_member(uuid) from anon;
revoke execute on function public.remove_member(uuid,uuid) from anon;
revoke execute on function public.claim_invitations() from anon;
