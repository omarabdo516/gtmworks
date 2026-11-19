begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
-- #200: a channel message that names a Member waits for them, under "Mentions of you", until they open it from that list.
-- A Member of that channel is named as #22 names one in a note, a Viewer included; never the writer, never a Member
-- outside the channel, never an invited person without a person, and never a name an Agent of the Company carries
-- (ADR 0015). A mention starts no Run and writes no log row. Only the mentioned Member reads the item, and only while
-- they are in the channel and the Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Sara Adel','Copy',false,'default');
insert into auth.users(id,email) values ('a2000000-0000-0000-0000-000000000010','sara@example.test');
insert into public.people(id,name) values ('a2000000-0000-0000-0000-000000000010','Sara Adel');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000010','contributor');
insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000001','delivery@example.test','contributor');
create temporary table general(id uuid) on commit drop;
insert into general values ('69000000-0000-0000-0000-000000000001');
create temporary table sent(label text, id bigint) on commit drop;
create temporary table team(id uuid) on commit drop;
create temporary table logged(at bigint) on commit drop;
grant select on general to authenticated;
grant select, insert on team to authenticated;
grant select, insert on sent to authenticated;
insert into logged select coalesce(max(id),0) from public.company_log;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- One message names a Manager and a Viewer.
insert into sent values ('two',public.post_channel_message((select id from general),'c2000000-0000-0000-0000-000000000002','@مدير و @مشاهد شوفوا ده'));
insert into sent values ('self',public.post_channel_message((select id from general),gen_random_uuid(),'@عمر فاكر نفسي'));
insert into sent values ('agent',public.post_channel_message((select id from general),gen_random_uuid(),'@Sara Adel خدي بالك'));
insert into sent values ('invitee',public.post_channel_message((select id from general),gen_random_uuid(),'@Delivery صباح الخير'));
-- The same message again, under the same send key, is the same message.
insert into sent values ('again',public.post_channel_message((select id from general),'c2000000-0000-0000-0000-000000000002','@مدير و @مشاهد شوفوا ده'));
-- A team channel holds one Member, and the Owner names them beside a Member outside it.
insert into team select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'نشر',array['20000000-0000-0000-0000-000000000003']::uuid[],null);
insert into sent select 'team',public.post_channel_message((select id from team),gen_random_uuid(),'يا @مدير و @مراجع');
reset role;

select is((select count(*)::int from public.waiting_items where kind='channel_mention' and channel_message_id=(select id from sent where label='two')),2,
 'a message that names two Members makes one waiting item for each');
select is((select array_agg(person_id::text order by person_id) from public.waiting_items where channel_message_id=(select id from sent where label='two')),
 array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004'],
 'for the Manager and the Viewer it names, and nobody else');
select is((select array_agg(kind||':'||title||':'||asked_by order by person_id) from public.waiting_items where channel_message_id=(select id from sent where label='two')),
 array['channel_mention:general:عمر','channel_mention:general:عمر'],
 'each names its kind, the general channel and the Member who wrote it');
select is((select left(body,40) from public.waiting_items where kind='channel_mention' and person_id='20000000-0000-0000-0000-000000000002'),'@مدير و @مشاهد شوفوا ده',
 'and carries the message itself');
select is((select count(*)::int from public.channel_runs where message_id=(select id from sent where label='two')),0,'a mention starts no Run');
select is((select count(*)::int from public.company_log where id>(select at from logged)),0,'and writes no log row');
select is((select count(*)::int from public.waiting_items where channel_message_id=(select id from sent where label='self')),0,'naming oneself makes none');
select is((select count(*)::int from public.waiting_items where channel_message_id=(select id from sent where label='again')),2,'the same message sent again makes no second item');
select is((select count(*)::int from public.waiting_items where kind='channel_mention'),3,'and adds nothing to the list');
select is((select count(*)::int from public.waiting_items where channel_message_id=(select id from sent where label='agent')),0,
 'a Member whose name an Agent of the Company carries is never mentioned as a person (ADR 0015)');
select is((select count(*)::int from public.waiting_items where channel_message_id=(select id from sent where label='invitee')),0,
 'an invited person who has not joined is never mentioned');
select is((select count(*)::int from public.waiting_items where channel_message_id=(select id from sent where label='team')),1,
 'a team channel''s message names the Member in it');
select is((select array_agg(person_id::text) from public.waiting_items where channel_message_id=(select id from sent where label='team')),
 array['20000000-0000-0000-0000-000000000003'],'and never a Member outside that channel');
select is((select title from public.waiting_items where channel_message_id=(select id from sent where label='team')),'نشر','the item names its team channel');

-- The mentioned Member reads their item, and only them.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),1,
 'the mentioned Member finds their item in their own list');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),1,
 'so does a Viewer, who is mentioned as anyone else is');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),0,
 'a Member the message does not name reads none of it');
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.waiting_items where kind='channel_mention'),0,'a Member of another Company reads none of it');

-- Out of the Company, out of the list.
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),0,
 'taken out of the Company, the Viewer no longer sees the item');
reset role;
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004';

-- Out of the channel, out of the list.
delete from public.channel_people where channel_id=(select id from team) and person_id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),0,
 'taken out of the channel, its Member no longer sees the item in their list');
select is((select count(*)::int from public.waiting_items where kind='channel_mention'),0,'nor by reading the table');
reset role;
insert into public.channel_people(channel_id,company_id,person_id,added_by)
 values ((select id from team),'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001');

-- Opening it from the list resolves the reader's own item, and only theirs.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(public.read_channel_mention((select id from general),(select id from sent where label='two')),'the mentioned Member opens their item');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),0,
 'and it is gone from their list');
select is(public.read_channel_mention((select id from general),(select id from sent where label='two')),false,'opening it again changes nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.read_channel_mention((select id from general),(select id from sent where label='two')),false,'another Member resolves nothing of theirs');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select ok(public.read_channel_mention((select id from general),(select id from sent where label='two')),'the Viewer opens theirs from the list');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='channel_mention'),0,
 'and it is gone from their list too');
reset role;
select is((select count(*)::int from public.waiting_items where kind='channel_mention' and resolved_at is not null),2,
 'both items are done, and the team channel''s still waits');

select * from finish();
rollback;
