-- Deliberately broken (reverted next, #259): the escape string hides the second statement from the statement counter.
select json_build_object('ok', true, E'it\'s fine', true);
select 1/0
