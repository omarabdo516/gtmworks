-- #468: the update row can say the running version is already the newest of the channel, and an Owner reads it.
select json_build_object(
 'current_state_allowed',exists(select 1 from pg_constraint where conrelid='public.install_updates'::regclass
  and conname='install_updates_state_check' and pg_get_constraintdef(oid) like '%''current''%'),
 'every_state_allowed',(select count(*)=6 from unnest(array['idle','requested','updating','updated','current','failed']) state
  where (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.install_updates'::regclass and conname='install_updates_state_check') like '%'''||state||'''%')
);
