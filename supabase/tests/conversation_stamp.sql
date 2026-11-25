begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- #767: a Conversation's stamp changes when a row its record reads changes, stays the same otherwise, and is read only by
-- the Conversation's own person. RS Learning: Omar (1) is Owner, 3 a Contributor.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7670000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7670000-0000-0000-0000-000000000001','Stamped','General',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c7670000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7670000-0000-0000-0000-000000000001','Stamped');
create table pg_temp.stamps(at int, stamp text);
grant all on pg_temp.stamps to authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into pg_temp.stamps values (1,public.conversation_stamp('c7670000-0000-0000-0000-000000000001'));
select is(public.conversation_stamp('c7670000-0000-0000-0000-000000000001'),(select stamp from pg_temp.stamps where at=1),'nothing changed: the same stamp');
select is(public.queue_conversation_turn('c7670000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a7670000-0000-0000-0000-000000000001','d7670000-0000-0000-0000-000000000001','Plan it')->>'state','queued','a message is sent');
-- A new transaction id: the row is written by this transaction, whose id differs from the seed's.
select isnt(public.conversation_stamp('c7670000-0000-0000-0000-000000000001'),(select stamp from pg_temp.stamps where at=1),'the stamp changes with it');
select ok(length(public.conversation_stamp('c7670000-0000-0000-0000-000000000001'))=32,'a stamp is one md5');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.conversation_stamp('c7670000-0000-0000-0000-000000000001'),null,'anyone else reads none');
select * from finish();
rollback;
