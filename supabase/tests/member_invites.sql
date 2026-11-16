begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #185: RS Learning with Lead (main), Ads, SEO and Coder. The Owner invites a Member from the Team table, switches two
-- Agents on for the invitation, and the invited person joins seeing those and no other.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
 select ('f1850000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','invites-'||n,'ciphertext','connected' from generate_series(1,4) n;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a1850000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1850000-0000-0000-0000-000000000001','Lead','General',true),
 ('a1850000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1850000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('a1850000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f1850000-0000-0000-0000-000000000003','SEO','SEO',false),
 ('a1850000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','f1850000-0000-0000-0000-000000000004','Coder','Code',false);
insert into auth.users(id,email) values ('a1850000-0000-0000-0000-000000000010','nour@example.test');
create temporary table invited(id uuid) on commit drop;
grant all on invited to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- Only the Owner invites.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','someone@example.test','viewer')$$,'42501','inviteNotAllowed','a Manager cannot invite');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','someone@example.test','viewer')$$,'42501','inviteNotAllowed','nor a Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','someone@example.test','viewer')$$,'42501','inviteNotAllowed','nor a Viewer');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$insert into invited select public.invite_member('10000000-0000-0000-0000-000000000001','  Nour@Example.test ','contributor')$$,'the Owner invites a Contributor');
select is((select email from public.member_invitations where id=(select id from invited)),'nour@example.test','the email is kept trimmed and in lower case');

-- Each refusal makes no invitation.
create temporary table before_count as select count(*) n from public.member_invitations;
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','   ','viewer')$$,'22023','inviteEmailEmpty','an empty email is refused');
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','nour@example','viewer')$$,'22P02','inviteEmailMalformed','an email with no full domain is refused');
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','NOUR@example.TEST','viewer')$$,'23505','inviteEmailTaken','an open invitation in another letter case is taken');
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','Viewer@Example.com','manager')$$,'23505','inviteEmailTaken','and so is a Member''s email');
select throws_ok($$select public.invite_member('10000000-0000-0000-0000-000000000001','new@example.test','owner')$$,'22004','inviteRoleNotAllowed','an Owner is not invited here');
select is((select count(*) from public.member_invitations),(select n from before_count),'no refused invitation was made');

-- Two switches on the invited row; Coder stays off.
select lives_ok($$select public.set_invitation_agent_visible('10000000-0000-0000-0000-000000000001',(select id from invited),'a1850000-0000-0000-0000-000000000002',true)$$,'the Owner switches Ads on for the invitation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_invitation_agent_visible('10000000-0000-0000-0000-000000000001',(select id from invited),'a1850000-0000-0000-0000-000000000003',true)$$,'a Manager switches SEO on');
select is((select count(*)::int from public.invitation_agent_access),2,'a Manager reads the invitation''s switches');
select throws_ok($$select public.set_invitation_agent_visible('10000000-0000-0000-0000-000000000001',(select id from invited),'a1850000-0000-0000-0000-000000000001',true)$$,'42501','mainAgentShownToAll','the main Agent has no switch');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_invitation_agent_visible('10000000-0000-0000-0000-000000000001',(select id from invited),'a1850000-0000-0000-0000-000000000004',true)$$,'42501','agentVisibilityNotAllowed','a Contributor cannot switch one');
select is((select count(*)::int from public.invitation_agent_access),0,'nor read them');

-- The log row: who invited, the email and the Role, for the Owner and the Managers only.
select is((select count(*)::int from public.company_log where action='member_invited'),0,'a Contributor does not read "invited a member"');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.company_log where action='member_invited'),0,'nor does a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_log where action='member_invited'),1,'a Manager reads it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select jsonb_build_object('actor',actor_id,'kind',actor_kind,'subject',subject,'email',details->>'email','role',details->>'role') from public.company_log where action='member_invited'),
 jsonb_build_object('actor','20000000-0000-0000-0000-000000000001','kind','person','subject','member','email','nour@example.test','role','contributor'),'the Owner reads one row naming who invited, the email and the Role');

-- The invited person joins and sees the two Agents switched on, Lead, and nothing else.
select set_config('request.jwt.claim.sub','a1850000-0000-0000-0000-000000000010',true);
select lives_ok($$select public.claim_invitations()$$,'the invited person accepts');
select is(array[public.can_see_agent('10000000-0000-0000-0000-000000000001','a1850000-0000-0000-0000-000000000002'),
  public.can_see_agent('10000000-0000-0000-0000-000000000001','a1850000-0000-0000-0000-000000000003'),
  public.can_see_agent('10000000-0000-0000-0000-000000000001','a1850000-0000-0000-0000-000000000004')],array[true,true,false],'they see Ads and SEO, and not Coder');
select is((select string_agg(name,',' order by name) from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),'Ads,Lead,SEO','their Agents are the switched ones and the main Agent');
select * from finish();
rollback;
