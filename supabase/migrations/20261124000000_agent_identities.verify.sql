select json_build_object(
 'signed_in_identity_read',has_function_privilege('authenticated','public.agent_identities()','execute') and not has_function_privilege('anon','public.agent_identities()','execute')
);
