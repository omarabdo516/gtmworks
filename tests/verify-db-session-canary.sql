-- The verify session's own check on real psql (ci.sh database, #259): the first statement fails and the second passes,
-- so the session must fail this file. The escape string hides the second statement from the one-statement guard.
select E'\'' as quote, 1/0;
select json_build_object('ok', true);
