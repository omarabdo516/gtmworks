-- The verify session's own check on real psql (ci.sh database, #259): this one statement fails, so the session must
-- fail the file with its error.
select json_build_object('divides', 1 / 0 = 0);
