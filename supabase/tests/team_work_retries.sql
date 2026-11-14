begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- RS Learning: Omar (1) is Owner, 2 is the Manager (مدير).
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('e0000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','retries','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('e1000000-0000-0000-0000-000000000311','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000311','Mona','Writing',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- Secrets with a quoted name or inside an address are refused by the database too.
select throws_ok($$select public.save_member_note('10000000-0000-0000-0000-000000000001','{"password":"hunter22"}')$$,'22023','memberNoteSecret','a JSON password is refused');
select throws_ok($$select public.save_member_note('10000000-0000-0000-0000-000000000001','Use postgresql://alice:hunter22@localhost/db for reports')$$,'22023','memberNoteSecret','a password inside an address is refused');
select throws_ok($$select public.save_member_note('10000000-0000-0000-0000-000000000001','DB_PASSWORD=hunter22')$$,'22023','memberNoteSecret','an .env password is refused');

-- A retried @person message keeps its first answer, even after its recipient is renamed.
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000301','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','e3000000-0000-0000-0000-000000000301','@مدير check the budget')->>'state','note','a message to a Member is a note');
reset role;
update public.people set name='المدير المالي' where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000301','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','e3000000-0000-0000-0000-000000000301','@مدير check the budget')->>'state','note','its retry is still that note after the recipient was renamed');
reset role;
select is((select count(*)::int from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000301'),0,'and no run was reserved for it');
select is((select count(*)::int from public.conversation_notes where send_key='e3000000-0000-0000-0000-000000000301'),1,'one note');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A run's note is pinned at its first reservation: a retry with the same key sends it again, a new key the new note.
select is(public.save_member_note('10000000-0000-0000-0000-000000000001','Answer in short points.'),'Answer in short points.','the first note');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000302','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','e3000000-0000-0000-0000-000000000302','First')->>'note','Answer in short points.','a run is reserved with the sender''s note');
select is(public.save_member_note('10000000-0000-0000-0000-000000000001','Answer at length.'),'Answer at length.','the note is edited before the retry');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000302','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','e3000000-0000-0000-0000-000000000302','First')->>'note','Answer in short points.','the retry of that run carries the note it was first reserved with');

-- A queued turn whose start had an unknown outcome is claimed again on its own reservation, with its pinned note.
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000302','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','First','e3000000-0000-0000-0000-000000000302','retries_run_1','e0000000-0000-0000-0000-000000000311'),true,'the first run is recorded');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000302','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000311','e3000000-0000-0000-0000-000000000303','Second')->>'state','queued','a second message waits');
reset role;
set local role service_role;
select is(public.close_conversation_run('e2000000-0000-0000-0000-000000000302','retries_run_1','completed','Done','session_1',1,1),true,'the first run ends');
select is((select send_key::text||' '||note from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000302')),'e3000000-0000-0000-0000-000000000303 Answer at length.','the waiting turn is claimed with the note of now, pinned');
reset role;
update public.member_notes set note='Changed again.' where person_id='20000000-0000-0000-0000-000000000001';
set local role service_role;
select is((select send_key::text||' '||connection::text||' '||note from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000302')),'e3000000-0000-0000-0000-000000000303 e0000000-0000-0000-0000-000000000311 Answer at length.','an unrecorded start is claimed again on the same reservation, with the same note');

select * from finish();
rollback;
