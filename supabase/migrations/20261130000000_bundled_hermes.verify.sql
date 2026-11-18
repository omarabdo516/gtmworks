-- The previous version's bundled provider was dropped with #342 (20270213000000): each Company is attached to its own
-- profile instead (attach_company_profile).
select json_build_object(
 'provider_dropped',to_regprocedure('public.provide_bundled_hermes(text,text,text,text,text[])') is null and to_regprocedure('public.bundled_hermes_waiting()') is null
);
