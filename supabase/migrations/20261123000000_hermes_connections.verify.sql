-- Pasted Connections were dropped with the one-Hermes change (#342, 20270213000000); the bundled Hermes key lives in the
-- install's environment only.
select json_build_object(
 'connections_dropped',to_regclass('public.hermes_connections') is null
);
