begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- A Conversation's files (#21) are as private as the Conversation: its own person reads them while they see its Agent;
-- another Member of the same Company, whatever their Role, and a Member of another Company read none, and nobody
-- writes them by hand.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
 select ('f2100000-0000-0000-0000-00000000000'||n)::uuid,case when n=3 then '10000000-0000-0000-0000-000000000003' else '10000000-0000-0000-0000-000000000001' end::uuid,
  '20000000-0000-0000-0000-000000000001','http://localhost','files-'||n,'ciphertext','connected' from generate_series(1,3) n;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a2100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2100000-0000-0000-0000-000000000001','Lead','General',true),
 ('a2100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2100000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('a2100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','f2100000-0000-0000-0000-000000000003','Lead','General',true);
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2100000-0000-0000-0000-000000000002');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c2100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a2100000-0000-0000-0000-000000000002','Ads'),
 ('c2100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2100000-0000-0000-0000-000000000002','Ads'),
 ('c2100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005','a2100000-0000-0000-0000-000000000003','Lead');
insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path) values
 ('10000000-0000-0000-0000-000000000001','c2100000-0000-0000-0000-000000000001','owner-brief.pdf','application/pdf',1200,'10000000-0000-0000-0000-000000000001/conversations/owner-brief.pdf'),
 ('10000000-0000-0000-0000-000000000001','c2100000-0000-0000-0000-000000000002','reviewer-notes.txt','text/plain',300,'10000000-0000-0000-0000-000000000001/conversations/reviewer-notes.txt'),
 ('10000000-0000-0000-0000-000000000003','c2100000-0000-0000-0000-000000000003','aleem-plan.csv','text/csv',90,'10000000-0000-0000-0000-000000000003/conversations/aleem-plan.csv');
select throws_ok($$insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path) values ('10000000-0000-0000-0000-000000000001','c2100000-0000-0000-0000-000000000001','elsewhere.pdf','application/pdf',1,'10000000-0000-0000-0000-000000000003/elsewhere.pdf')$$,
 '23514',null,'a file stays in its Company''s folder');
select throws_ok($$insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path) values ('10000000-0000-0000-0000-000000000001','c2100000-0000-0000-0000-000000000003','crossed.pdf','application/pdf',1,'10000000-0000-0000-0000-000000000001/crossed.pdf')$$,
 '23503',null,'a file belongs to a Conversation of its own Company');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select jsonb_agg(name order by name) from public.conversation_attachments),jsonb_build_array('owner-brief.pdf'),'the Owner reads the files of their own Conversation only');
select throws_ok($$insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path) values ('10000000-0000-0000-0000-000000000001','c2100000-0000-0000-0000-000000000001','added.pdf','application/pdf',1,'10000000-0000-0000-0000-000000000001/added.pdf')$$,
 '42501',null,'nobody adds a file by hand');
select throws_ok($$update public.conversation_attachments set name='renamed.pdf'$$,'42501',null,'nobody renames a file');
select throws_ok($$delete from public.conversation_attachments$$,'42501',null,'nobody deletes a file');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select jsonb_agg(name order by name) from public.conversation_attachments),jsonb_build_array('reviewer-notes.txt'),'a Contributor reads the files of their own Conversation only');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.conversation_attachments),0::bigint,'a Manager reads no other person''s Conversation files');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select jsonb_agg(name order by name) from public.conversation_attachments),jsonb_build_array('aleem-plan.csv'),'a Member of two Companies reads their own files in the other Company, and none of RS Learning''s');
select * from finish();
rollback;
