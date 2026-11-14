insert into public.companies (id,slug,name) values
('10000000-0000-0000-0000-000000000001','rs-learning','RS Learning'),
('10000000-0000-0000-0000-000000000002','rs-consultations','R&S Consultations'),
('10000000-0000-0000-0000-000000000003','aleem','Aleem');
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token) values
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','omar@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000002','authenticated','authenticated','manager@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000003','authenticated','authenticated','reviewer@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000004','authenticated','authenticated','viewer@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000005','authenticated','authenticated','multi@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','');
insert into auth.identities (id,user_id,identity_data,provider,provider_id,last_sign_in_at,created_at,updated_at) select id,id,jsonb_build_object('sub',id::text,'email',email),'email',email,now(),now(),now() from auth.users where id::text like '20000000-%';
insert into public.people (id,name) values ('20000000-0000-0000-0000-000000000001','عمر'),('20000000-0000-0000-0000-000000000002','مدير'),('20000000-0000-0000-0000-000000000003','مراجع'),('20000000-0000-0000-0000-000000000004','مشاهد'),('20000000-0000-0000-0000-000000000005','عضو');
insert into public.members (company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) select id,'20000000-0000-0000-0000-000000000001','owner',true,true,true from public.companies;
update public.approval_steps set person_id='20000000-0000-0000-0000-000000000001',role=null where company_id='10000000-0000-0000-0000-000000000001';
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
insert into public.work_cards(company_id,stage_id,title,channel,format,go_live,next_actor) select s.company_id,s.id,x.title,x.channel,x.format,now()+make_interval(days=>x.days),'30000000-0000-0000-0000-000000000001' from (values (1,'أفكار لمحتوى الشهر','Instagram','بوست',4),(2,'دليلك لاختيار المسار المناسب','Facebook','كاروسيل',8),(3,'نصائح للمتعلّمين الجدد','Instagram','ريل',12),(4,'رحلة التعلّم تبدأ هنا','Instagram','بوست',16),(5,'إعلان البرنامج القادم','Facebook','كاروسيل',20)) x(pos,title,channel,format,days) join public.work_stages s on s.position=x.pos and s.company_id='10000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','',false);
-- Seed distinct agent actions and assignments through the same audit triggers.
do $$ declare n integer; agent uuid; target bigint; begin
 for n in 1..5 loop
  agent=('30000000-0000-0000-0000-00000000000'||n)::uuid;
  select id into target from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' order by id offset n-1 limit 1;
  perform set_config('request.jwt.claim.sub',agent::text,true);
  update public.work_cards set next_actor=agent where id=target and approval_step_id is null;
  insert into public.work_assignees(company_id,card_id,person_id) values ('10000000-0000-0000-0000-000000000001',target,agent);
  insert into public.work_checklist(company_id,card_id,title,done) values ('10000000-0000-0000-0000-000000000001',target,'Caption Written',n<3);
  insert into public.work_card_labels(company_id,card_id,label_id) select '10000000-0000-0000-0000-000000000001',target,id from public.work_labels where company_id='10000000-0000-0000-0000-000000000001' and name=case when n=3 then 'reel' when n in (2,5) then 'carosel' else 'static' end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
end $$;

-- Public local fixture only; never use this key outside the local seed.
insert into public.agent_keys(company_id,person_id,key_hash) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','f0358ec2fdc223a1ac2213a6e4b2cec6efe6d175ec823cb2a574e15ecdcf8226');

-- The four role agents are shared identities; the local fixture grants them to RS Learning only.
insert into public.agents(id,role) select person_id,agent_role::text from public.members where company_id='10000000-0000-0000-0000-000000000001' and agent_role is not null;
insert into public.agent_grants(company_id,agent_id) select company_id,person_id from public.members where company_id='10000000-0000-0000-0000-000000000001' and agent_role is not null;
