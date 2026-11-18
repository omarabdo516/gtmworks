begin;
create extension if not exists pgtap with schema extensions;
select plan(48);
-- #207: an invited person is in the general channel from the invite, with the name made from their email, their Role and
-- "Invite sent"; the Owner and the Managers see the email, everyone else does not. A team channel holds the invitations it
-- was given, and they become Members of it when they join.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a2070000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2070000-0000-0000-0000-000000000001','Lead','General',true,'default');
insert into auth.users(id,email) values
 ('a2070000-0000-0000-0000-000000000010','delivery@example.test'),
 ('a2070000-0000-0000-0000-000000000011','mona_ali+ads@example.test'),
 ('a2070000-0000-0000-0000-000000000012','outsider@example.test');
insert into public.people(id,name) values ('a2070000-0000-0000-0000-000000000012','Hala');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','a2070000-0000-0000-0000-000000000012','manager');
create temporary table general(id uuid) on commit drop;
insert into general values ('69000000-0000-0000-0000-000000000001');
grant select on general to authenticated;
create temporary table invited(label text, id uuid) on commit drop;
grant select, insert on invited to authenticated;
create temporary table made(label text, id uuid) on commit drop;
grant select, insert on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- The Owner invites two people.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into invited values ('delivery',public.invite_member('10000000-0000-0000-0000-000000000001','delivery@example.test','contributor'));
insert into invited values ('mona',public.invite_member('10000000-0000-0000-0000-000000000001','MONA_ali+ads@example.test','viewer'));
select is((select count(*)::int from invited),2,'the Owner invites two people');

-- The general channel's Members hold both, with the name made from the email.
select is((select array_agg(name||':'||role||':'||coalesce(email,'-') order by name) from public.channel_members((select id from general)) where invitation is not null),
 array['Delivery:contributor:delivery@example.test','Mona:viewer:mona_ali+ads@example.test'],'an open invitation is a Member row with the name made from the email, its Role and, for the Owner, its email');
select is((select name from public.channel_members((select id from general)) where invitation=(select id from invited where label='mona')),'Mona',
 'the name is the first word of the email before the @, a capital first letter and the rest in lower case');
select is((select count(*)::int from public.channel_members((select id from general)) where person is null),2,'neither has a person yet');
select is((select count(*)::int from public.channel_members((select id from general))),8,'the count includes both invited people with the six Members');

-- A Manager reads the email; a Contributor and a Viewer read the row without it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select email from public.channel_members((select id from general)) where invitation=(select id from invited where label='delivery')),'delivery@example.test','a Manager reads the invited person''s email');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(coalesce(email,'-') order by name) from public.channel_members((select id from general)) where invitation is not null),array['-','-'],'a Contributor reads the invited rows with no email');
select is((select array_agg(name||':'||role order by name) from public.channel_members((select id from general)) where invitation is not null),array['Delivery:contributor','Mona:viewer'],'with their name and Role');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.channel_members((select id from general)) where invitation is not null and email is not null),0,'a Viewer reads no email either');
select is((select count(*)::int from public.member_invitations where company_id='10000000-0000-0000-0000-000000000001'),0,'nor any invitation row');

-- One quiet line per invitation in the general channel, not a message and starting no Run.
select set_config('request.jwt.claim.sub','a2070000-0000-0000-0000-000000000010',true);
select throws_ok($$select public.post_channel_message((select id from general),gen_random_uuid(),'Can I write?')$$,'P0002','channelNotFound',
 'an invited person who has not joined writes nothing in the channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select array_agg(kind||':'||invitee_name||':'||actor_name order by invitee_name) from public.channel_notes where channel_id=(select id from general)),
 array['invite:Delivery:عمر','invite:Mona:عمر'],'the Owner reads one quiet line per invitation, naming who invited and the name from the email');
select is((select count(*)::int from public.channel_notes where channel_id=(select id from general)),2,'one line per invitation');
select is((select count(*)::int from public.channel_messages where channel_id=(select id from general)),0,'a note is not a message');
select is((select count(*)::int from public.channel_runs),0,'and starts no Run');
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','Delivery@Example.test','manager')$$,'23505','inviteEmailTaken','inviting the same person again is refused');
select is((select count(*)::int from public.channel_notes where channel_id=(select id from general)),2,'and adds no second line');

-- A team channel made with an invitation holds it; a Contributor in it reads the row without the email.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into made values ('launch',public.create_channel_inviting('10000000-0000-0000-0000-000000000001','c2070000-0000-0000-0000-000000000001','Launch week',
 array['20000000-0000-0000-0000-000000000003']::uuid[],array['a2070000-0000-0000-0000-000000000001']::uuid[],array[(select id from invited where label='delivery')]::uuid[]));
select is((select array_agg(name||':'||role||':'||case when email is null then '-' else email end) from public.channel_members((select id from made where label='launch')) where invitation is not null),
 array['Delivery:contributor:delivery@example.test'],'a team channel made with an invitation holds the invited person, email and all, for its Manager');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(name||':'||role||':'||coalesce(email,'-')) from public.channel_members((select id from made where label='launch')) where invitation is not null),
 array['Delivery:contributor:-'],'a Contributor in it reads the name, the Role and no email');
select is((select count(*)::int from public.channel_members((select id from made where label='launch'))),3,'the invited person counts as a member of it');

-- A Manager adds and takes out the other invitation; a Contributor and a Viewer cannot.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),true)$$,'a Manager adds an invited person to a team channel');
select lives_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),true)$$,'adding them again changes nothing');
select is((select count(*)::int from public.channel_members((select id from made where label='launch')) where invitation is not null),2,'both invitations are in it once');
select lives_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),false)$$,'and takes one out');
select is((select count(*)::int from public.channel_members((select id from made where label='launch')) where invitation is not null),1,'which leaves one');
select lives_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),true)$$,'and puts it back');
select is((select count(*)::int from public.channel_people where channel_id=(select id from made where label='launch')),2,'while the people of the channel stay as they were');
select lives_ok($$select public.set_channel_person((select id from made where label='launch'),'20000000-0000-0000-0000-000000000004',true)$$,'the Manager puts the Viewer in the channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),true)$$,'42501','channelNotAllowed','a Contributor cannot add an invited person');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_channel_invitee((select id from made where label='launch'),(select id from invited where label='mona'),true)$$,'42501','channelNotAllowed','nor the Viewer');
select throws_ok($$select public.set_channel_invitee((select id from general),(select id from invited where label='mona'),true)$$,'42501','channelNotAllowed','and the general channel''s invitees are never chosen');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.create_channel_inviting('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Outsider',array[(select id from invited where label='mona')]::uuid[],null,null)$$,
 'P0002','memberNotFound','an invitation is not a person');
reset role;
insert into public.member_invitations(id,company_id,email,role) values ('b2070000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000003','elsewhere@example.test','manager');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_channel_invitee((select id from made where label='launch'),'b2070000-0000-0000-0000-000000000099',true)$$,
 'P0002','memberNotFound','and another Company''s invitation is refused');

-- A Member of another Company reads none of it.
select set_config('request.jwt.claim.sub','a2070000-0000-0000-0000-000000000012',true);
select is((select count(*)::int from public.channel_members((select id from general)))
 +(select count(*)::int from public.channel_notes where company_id='10000000-0000-0000-0000-000000000001')
 +(select count(*)::int from public.channel_invitees where company_id='10000000-0000-0000-0000-000000000001')
 +(select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001'),0,
 'a Member of another Company reads no invited row, note or channel');

-- The invited person joins: their rows become their Member rows, with the name they gave, and they read both channels.
reset role;
insert into public.people(id,name) values ('a2070000-0000-0000-0000-000000000010','Nour Hassan');
set local role authenticated;
select set_config('request.jwt.claim.sub','a2070000-0000-0000-0000-000000000010',true);
select lives_ok($$select public.claim_invitations()$$,'the invited person accepts');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select array_agg(person||':'||name||':'||role) from public.channel_members((select id from general)) where person='a2070000-0000-0000-0000-000000000010'),
 array['a2070000-0000-0000-0000-000000000010:Nour Hassan:contributor'],'their general row is their Member row now, with the name they gave');
select is((select array_agg(person||':'||name order by name) from public.channel_members((select id from made where label='launch')) where person='a2070000-0000-0000-0000-000000000010'),
 array['a2070000-0000-0000-0000-000000000010:Nour Hassan'],'and their team channel row too');
select is((select count(*)::int from public.channel_invitees where invitation_id=(select id from invited where label='delivery')),0,'their invitation left the channel list');
select is((select count(*)::int from public.channel_people where channel_id=(select id from made where label='launch') and person_id='a2070000-0000-0000-0000-000000000010'),1,'and became a person of the channel');
select set_config('request.jwt.claim.sub','a2070000-0000-0000-0000-000000000010',true);
select is((select array_agg(kind::text order by kind) from public.channels),array['general','team'],'they read the general channel and the team channel they were invited to');
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),0,'with nothing before their join unread');
select ok(public.in_channel((select id from made where label='launch')),'and they are in the team channel');
select is((select count(*)::int from public.channel_messages where channel_id=(select id from general)),0,'the note is still not a message, and the channel holds no message of theirs');

-- Withdrawn: the rows and the counts drop the invited person; the line the channel got stays.
reset role;
delete from public.member_invitations where id=(select id from invited where label='mona');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channel_members((select id from general)) where invitation is not null),0,'a withdrawn invitation leaves the channel''s Members');
select is((select count(*)::int from public.channel_members((select id from general))),7,'and its count');
select is((select count(*)::int from public.channel_notes where channel_id=(select id from general)),2,'the line the channel got stays');
select is((select count(*)::int from public.channel_notes where invitee_name='Mona'),1,'with the name it had');
select is((select count(*)::int from public.channel_invitees),0,'and a team channel keeps none of it');

select * from finish();
rollback;
