-- Optional data for representative design comparisons (design/COMPARE.md, "Representative captures"): the
-- reference's five Agents in RS Learning, Lead the main one, and one Conversation of Omar's with Lead holding a
-- message and a reply. Nothing applies it automatically; load it by hand into a throwaway local database only.
-- Fixed ids (scripts/design-compare-lib.mjs, fixture); running it again adds nothing. The connections point nowhere
-- and hold no key: they are never called.
begin;

-- Refuse every database but the seeded local one: it must hold the seed's Omar and its public test-only agent key,
-- which no real installation has. The whole file is one transaction, so a refusal writes nothing.
do $$ begin
 if not exists(select 1 from auth.users where id='20000000-0000-0000-0000-000000000001' and email='omar@example.com')
  or not exists(select 1 from public.agent_keys where key_hash='f0358ec2fdc223a1ac2213a6e4b2cec6efe6d175ec823cb2a574e15ecdcf8226') then
  raise exception 'design-compare fixture: only for the seeded local database (supabase/seed.sql)';
 end if;
end $$;

insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
select ('60000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'http://127.0.0.1:9/p/compare-'||n,'compare-'||n,'design-compare-fixture-no-key','unreachable'
from generate_series(1,5) n
on conflict (id) do nothing;

-- Lead is the main Agent unless the company already has one.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default)
select ('61000000-0000-0000-0000-00000000000'||x.n)::uuid,'10000000-0000-0000-0000-000000000001',('60000000-0000-0000-0000-00000000000'||x.n)::uuid,
 x.name,x.speciality,x.n=1 and not exists(select 1 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default)
from (values (1,'Lead','Marketing lead'),(2,'Ads','Ads agent'),(3,'SEO & Content','Content & SEO agent'),(4,'Analyst','Analyst'),(5,'Critic','Critic')) x(n,name,speciality)
on conflict (id) do nothing;

insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
values ('62000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Lead')
on conflict (id) do nothing;

-- Messages are append-only and have no natural key: they are added only to an empty Conversation.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-'||x.n
from (values
 (1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','صباح الخير. إيه اللي مستنيني النهارده؟','63000000-0000-0000-0000-000000000001'::uuid),
 (2,'agent',null,'61000000-0000-0000-0000-000000000001'::uuid,'Lead','صباح الخير يا عمر. ده اللي مستنيك النهارده:
• حملة Meta للمحاسب الشامل مستنية موافقتك على الزاوية
• مقال SEO عن كورس محاسبة اونلاين جاهز للنشر بعد مراجعة Critic
• التقرير الأسبوعي هيخلص الخميس',null)
) x(n,author,person_id,agent_id,author_name,body,send_key)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000001')
order by x.n;

commit;
