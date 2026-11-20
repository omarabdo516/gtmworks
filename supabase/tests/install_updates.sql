begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- Update now (#443): an Owner of a Company asks for an update and reads its state; a Manager, a Viewer and anyone signed
-- out are refused and read nothing; the button the install owner turned off refuses even an Owner; and no role of the
-- app reaches the row itself, so the switches and the state are the updater's alone.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.install_update()->>'state','idle','an Owner reads the state');
select is(public.request_install_update(),'requested','an Owner asks for an update');
select is(public.request_install_update(),'requested','asking again while it waits changes nothing');
select throws_ok($$update public.install_updates set auto=true$$,'42501',null,'an Owner cannot turn automatic updates on');
select throws_ok($$select version from public.install_updates$$,'42501',null,'nor read the row itself');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(public.install_update() is null,'a Manager reads nothing');
select throws_ok($$select public.request_install_update()$$,'42501','updateNotAllowed','a Manager cannot ask');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.request_install_update()$$,'42501','updateNotAllowed','a Viewer cannot ask');
reset role;
update public.install_updates set state='failed', changed_at=now();
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.request_install_update()$$,'42501','updateFailedRecently','within an hour of a failed update a new request is refused');
reset role;
update public.install_updates set button=false, state='idle';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.request_install_update()$$,'42501','updateButtonOff','with the button off an Owner cannot ask');
select is((public.install_update()->>'button')::boolean,false,'and reads that the button is off');
reset role;
set local role service_role;
select throws_ok($$update public.install_updates set button=true$$,'42501',null,'the service role cannot turn the button on');
select * from finish();
rollback;
