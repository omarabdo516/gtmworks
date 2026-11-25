-- Each Company names the one Engine record it is made on (#382); the seed makes the three Companies below and keeps spare
-- waiting records for a Company a test makes. scripts/local-db.sh then points every record at the lane's fake Hermes and
-- encrypts its key, so the record is the only place the app and worker read them.
insert into public.company_engines (id,address,key_encrypted) values
('e3800000-0000-4000-8000-000000000001','http://127.0.0.1:8642','seed'),
('e3800000-0000-4000-8000-000000000002','http://127.0.0.1:8642','seed'),
('e3800000-0000-4000-8000-000000000003','http://127.0.0.1:8642','seed');
insert into public.company_engines (address,key_encrypted)
select 'http://127.0.0.1:8642','seed' from generate_series(1,20);
insert into public.companies (id,slug,name,engine_id) values
('10000000-0000-0000-0000-000000000001','rs-learning','RS Learning','e3800000-0000-4000-8000-000000000001'),
('10000000-0000-0000-0000-000000000002','rs-consultations','R&S Consultations','e3800000-0000-4000-8000-000000000002'),
('10000000-0000-0000-0000-000000000003','aleem','Aleem','e3800000-0000-4000-8000-000000000003');
update public.channels set id='69000000-0000-0000-0000-000000000001' where company_id='10000000-0000-0000-0000-000000000001' and kind='general';
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token) values
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','omar@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000002','authenticated','authenticated','manager@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000003','authenticated','authenticated','reviewer@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000004','authenticated','authenticated','viewer@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000005','authenticated','authenticated','multi@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','');
insert into auth.identities (id,user_id,identity_data,provider,provider_id,last_sign_in_at,created_at,updated_at) select id,id,jsonb_build_object('sub',id::text,'email',email),'email',email,now(),now(),now() from auth.users where id::text like '20000000-%';
insert into public.people (id,name) values ('20000000-0000-0000-0000-000000000001','عمر'),('20000000-0000-0000-0000-000000000002','مدير'),('20000000-0000-0000-0000-000000000003','مراجع'),('20000000-0000-0000-0000-000000000004','مشاهد'),('20000000-0000-0000-0000-000000000005','عضو');
insert into public.members (company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) select id,'20000000-0000-0000-0000-000000000001','owner',true,true,true from public.companies;
insert into public.members (company_id,person_id,role) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','manager'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','contributor'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','viewer'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','contributor'),
('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005','contributor');
insert into public.role_permissions (company_id,role,permission,allowed) select c.id,r.role,p.permission,case when p.permission in ('approve','reject') then r.role in ('owner','manager') else r.role <> 'viewer' end from public.companies c cross join unnest(enum_range(null::public.member_role)) as r(role) cross join (values ('approve'),('reject'),('edit')) as p(permission);
-- Record an example membership change through the same trigger used by the app.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);
update public.members set grant_publishing=true where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','',false);
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token) select '00000000-0000-0000-0000-000000000000',('30000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','agent'||n||'@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','' from generate_series(1,5) n;
-- Every local demo account, people and agents alike, signs in with one known password (tests/sign-in.ts). The install never
-- applies this seed.
update auth.users set encrypted_password=extensions.crypt('local-seed-password',extensions.gen_salt('bf')) where id::text like '20000000-%' or id::text like '30000000-%';
insert into public.people(id,name) select ('30000000-0000-0000-0000-00000000000'||n)::uuid, name from unnest(array['وكيل المحتوى','المصمم','الناقد','وكيل الإعلانات','Lead']) with ordinality x(name,n);
insert into public.members(company_id,person_id,role,agent_role) select '10000000-0000-0000-0000-000000000001',p.id,'contributor',x.agent_role::public.member_agent_role from (values (1,'writer'),(2,'designer'),(3,'critic'),(4,null),(5,'account_manager')) x(n,agent_role) join public.people p on p.id=('30000000-0000-0000-0000-00000000000'||x.n)::uuid;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',false);
-- The Card in review is written as a review leaves it (card_write_guard lets the database's own writes pass).
select set_config('approval.internal','yes',false);
-- Five Cards on RS Learning's board, one in each column of the work (#668): their channel, format and label and their
-- to-do item in the description, as Cards moved over from the old fields read (#684).
insert into public.work_cards(company_id,status,title,description,go_live) select '10000000-0000-0000-0000-000000000001',x.status,x.title,
 '**Channel:** '||x.channel||E'\n\n**Format:** '||x.format||E'\n\n**Labels:** '||x.label||E'\n\n- ['||case when x.pos<3 then 'x' else ' ' end||'] Caption Written',now()+make_interval(days=>x.days)
 from (values (1,'ideas','أفكار لمحتوى الشهر','Instagram','بوست','static',4),(2,'planned','دليلك لاختيار المسار المناسب','Facebook','كاروسيل','carosel',8),(3,'progress','نصائح للمتعلّمين الجدد','Instagram','ريل','reel',12),
  (4,'progress','رحلة التعلّم تبدأ هنا','Instagram','بوست','static',16),(5,'waiting','إعلان البرنامج القادم','Facebook','كاروسيل','carosel',20)) x(pos,status,title,channel,format,label,days) order by x.pos;
select set_config('approval.internal','',false);
select set_config('request.jwt.claim.sub','',false);
-- Each Card is on one of the legacy agent persons, through the same audit triggers; the Card in review is on the one who
-- sent it there, and its review waits for every Owner and Manager who sees it (#681).
do $$ declare n integer; agent uuid; target bigint; begin
 for n in 1..5 loop
  agent=('30000000-0000-0000-0000-00000000000'||case when n=5 then 1 else n end)::uuid;
  select id into target from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' order by id offset n-1 limit 1;
  perform set_config('request.jwt.claim.sub',agent::text,true);
  perform set_config('approval.internal',case when n=5 then 'yes' else '' end,true);
  update public.work_cards set assignee_person=agent,review_submitter=case when n=5 then agent end,review_entered_at=case when n=5 then now() end where id=target;
  if n=5 then insert into public.work_reviews(company_id,card_id,asked_by) values ('10000000-0000-0000-0000-000000000001',target,agent); end if;
 end loop;
 perform set_config('approval.internal','',true);
 perform set_config('request.jwt.claim.sub','',true);
end $$;


-- The four role agents are shared identities; the local fixture grants them to RS Learning only.
insert into public.agents(id,role) select person_id,agent_role::text from public.members where company_id='10000000-0000-0000-0000-000000000001' and agent_role is not null;
insert into public.agent_grants(company_id,agent_id) select company_id,person_id from public.members where company_id='10000000-0000-0000-0000-000000000001' and agent_role is not null;
