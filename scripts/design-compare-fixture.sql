-- Optional data for representative design comparisons (design/COMPARE.md, "Representative captures"): the
-- reference's five Agents in RS Learning, Lead the main one, one Conversation of Omar's with Lead holding a message and
-- a reply, the Conversation in which Lead made Ads at Omar's request on October 10 (#13; the reference's th-made-ads),
-- Ads already opened as in the reference, the Conversation in which Omar told Ads a lasting rule on November 14, with
-- the rule Ads keeps (#18; the reference's th-rule-ads), talk in the general channel (#23), and the first Contributor's
-- Conversation with Ads in which they told it a rule for the team, waiting on Omar and the Manager as a learning
-- suggestion (#25; the reference's th-yo-ads), Omar's Conversation with Ads waiting on his answer to its question (#138;
-- the reference's th-meta), Omar's Conversation with Ads in which it hands him the article to publish (#139; the
-- reference's th-team t10), Omar's Conversation in which Ads's Run waits on his OK to publish the article (#163; the
-- reference's th-seo), Omar's Conversation with Analyst in which it asks him to connect an app for the weekly report (#203;
-- the reference's th-report), and the files Ads works from (#21; the reference's ads.files): two on
-- its Card and one in Omar's Conversation with it. Two Cards are tied to those two chats with Ads (#145). Nothing applies it automatically; load it by hand into a throwaway
-- local database only. The files are named only: their bytes are not in storage, so opening one finds nothing.
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

-- Lead is the main Agent unless the company already has one. Lead made Ads for Omar. SEO & Content is made from the
-- ready-made SEO content writer (#170).
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps,requester_opened_at,template)
select ('61000000-0000-0000-0000-00000000000'||x.n)::uuid,'10000000-0000-0000-0000-000000000001',('60000000-0000-0000-0000-00000000000'||x.n)::uuid,
 x.name,x.speciality,x.n=1 and not exists(select 1 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),
 x.made,case when x.made is not null then '20000000-0000-0000-0000-000000000001'::uuid end,x.apps,x.made+interval '2 minutes',x.template
from (values (1,'Lead','Marketing lead',null::timestamptz,null::text[],null::text),(2,'Ads','Ads agent','2026-10-10T11:03:00Z',array['Meta Ads','Google Ads','GA4'],null),
 (3,'SEO & Content','Content & SEO agent',null,null,'writer'),(4,'Analyst','Analyst',null,null,null),(5,'Critic','Critic',null,null,null)) x(n,name,speciality,made,apps,template)
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

insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Lead','2026-10-10T11:02:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-made-'||x.run,x.at
from (values
 (1,1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','عايز حد يمسك إعلانات Meta وGoogle','63000000-0000-0000-0000-000000000002'::uuid,'2026-10-10T11:02:00Z'::timestamptz),
 (2,1,'agent',null,'61000000-0000-0000-0000-000000000001','Lead','تمام، عملتلك Ads. هيبدأ يقرا حساباتك على Meta وGoogle، وأي نشر أو صرف أو رسالة لعميل هيرجعلك فيها قبل ما يعملها.',null,'2026-10-10T11:03:00Z'),
 (3,2,'person','20000000-0000-0000-0000-000000000001',null,'عمر','تمام. خليه يبدأ بحملة «المحاسب الشامل»','63000000-0000-0000-0000-000000000003','2026-10-10T11:05:00Z'),
 (4,2,'agent',null,'61000000-0000-0000-0000-000000000001','Lead','سلّمتها لـ Ads في محادثته، وهيرجعلك بالخطة وتوزيع الميزانية قبل ما يطلق أي حاجة.',null,'2026-10-10T11:05:00Z')
) x(n,run,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000002')
order by x.n;
insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at)
values ('62000000-0000-0000-0000-000000000002','design-compare-fixture-made-1','call-0','10000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','2026-10-10T11:03:00Z')
on conflict do nothing;

-- Which Agents each Member sees (#15), as in the reference's ACCESS: the Manager every Agent, the first Contributor Ads
-- and Analyst, the Viewer SEO & Content, Analyst and Critic.
insert into public.member_agent_access(company_id,person_id,agent_id)
select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||x.person)::uuid,('61000000-0000-0000-0000-00000000000'||x.n)::uuid
from (values (2,2),(2,3),(2,4),(2,5),(3,2),(3,4),(4,3),(4,4),(4,5)) x(person,n)
on conflict do nothing;

insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Ads','2026-11-14T16:39:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000003',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-rule',x.at
from (values
 (1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها','63000000-0000-0000-0000-000000000004'::uuid,'2026-11-14T16:39:00Z'::timestamptz),
 (2,'agent',null,'61000000-0000-0000-0000-000000000002','Ads','تمام يا عمر. من دلوقتي أي حاجة رايحة لعميل، رسالة أو عرض أو رد على تعليق، هجهّزها وأستناك تشوفها الأول، وانت اللي تبعت.',null,'2026-11-14T16:40:00Z')
) x(n,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000003')
order by x.n;
insert into public.agent_rules(id,company_id,agent_id,body,said_by,said_at,conversation_id,run_id,call_id)
values ('64000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها',
 '20000000-0000-0000-0000-000000000001','2026-11-14T16:40:00Z','62000000-0000-0000-0000-000000000003','design-compare-fixture-rule','call-0')
on conflict do nothing;

insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000002','Ads','2026-11-15T07:20:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000004',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-suggestion',x.at
from (values
 (1,'person','20000000-0000-0000-0000-000000000003'::uuid,null::uuid,'مراجع','أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة، مش مصري','63000000-0000-0000-0000-000000000005'::uuid,'2026-11-15T07:20:00Z'::timestamptz),
 (2,'agent',null,'61000000-0000-0000-0000-000000000002','Ads','تمام، هشتغل كده في شغلي معاك من دلوقتي. وعشان دي حاجة هتمشي على الفريق كله، اقترحتها على عمر ومدير، ولما حد فيهم يوافق هتبقى للكل.',null,'2026-11-15T07:21:00Z')
) x(n,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000004')
order by x.n;
insert into public.agent_rules(id,company_id,agent_id,body,said_by,said_at,conversation_id,run_id,call_id,suggestion)
values ('64000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة، مش مصري',
 '20000000-0000-0000-0000-000000000003','2026-11-15T07:21:00Z','62000000-0000-0000-0000-000000000004','design-compare-fixture-suggestion','call-0','pending')
on conflict do nothing;
insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,agent_rule_id,created_at)
select '10000000-0000-0000-0000-000000000001',p.person,'rule_suggestion','أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة، مش مصري','Ads','مراجع','64000000-0000-0000-0000-000000000002','2026-11-15T07:21:00Z'
from (values ('20000000-0000-0000-0000-000000000001'::uuid),('20000000-0000-0000-0000-000000000002'::uuid)) p(person)
where not exists(select 1 from public.waiting_items where agent_rule_id='64000000-0000-0000-0000-000000000002');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key)
select '10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person',x.person_id,x.author_name,x.body,x.send_key
from (values
 (1,'20000000-0000-0000-0000-000000000001'::uuid,'عمر','صباح الخير يا جماعة. الدفعة الجديدة من «المحاسب الشامل» بتبدأ 1 ديسمبر، فكل حملات التسجيل لازم تبقى جاهزة قبل 20 نوفمبر.','63000000-0000-0000-0000-000000000011'::uuid),
 (2,'20000000-0000-0000-0000-000000000002','مدير','تمام. حملة Meta هتبقى جاهزة الأسبوع ده، وGoogle Search بعدها بيومين.','63000000-0000-0000-0000-000000000012'),
 (3,'20000000-0000-0000-0000-000000000003','مراجع','@Lead لخّصلنا مين مستني إيه النهارده.','63000000-0000-0000-0000-000000000013')
) x(n,person_id,author_name,body,send_key)
where not exists(select 1 from public.channel_messages where channel_id='69000000-0000-0000-0000-000000000001')
order by x.n;
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,outcome,closed_at)
select id,company_id,channel_id,'61000000-0000-0000-0000-000000000001','Lead','63000000-0000-0000-0000-000000000014','مراجع: '||body,1,now(),'design-compare-fixture-channel','completed',now()
from public.channel_messages where send_key='63000000-0000-0000-0000-000000000013'
on conflict do nothing;
insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to)
select company_id,channel_id,'agent','61000000-0000-0000-0000-000000000001','Lead','ده اللي واقف النهارده:
• حملة Meta للمحاسب الشامل: مستنية عمر يختار زاوية الإعلان
• مقال «كورس محاسبة اونلاين»: مستني موافقة النشر

الباقي ماشي لوحده، وهقولكم هنا لو حاجة وقفت.',id
from public.channel_messages where send_key='63000000-0000-0000-0000-000000000013'
on conflict do nothing;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value
select 640001,'10000000-0000-0000-0000-000000000001',id,'حملة Meta للمحاسب الشامل','61000000-0000-0000-0000-000000000002'
from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1
on conflict do nothing;
insert into public.work_comments(id,company_id,card_id,body,author_id) overriding system value
values (640002,'10000000-0000-0000-0000-000000000001',640001,'البريف والإعلانات','20000000-0000-0000-0000-000000000001')
on conflict do nothing;
insert into public.work_attachments(id,company_id,card_id,comment_id,name,content_type,size,path,created_by,created_at) overriding system value values
 (640003,'10000000-0000-0000-0000-000000000001',640001,640002,'brief-المحاسب-الشامل.pdf','application/pdf',245760,'10000000-0000-0000-0000-000000000001/design-compare/brief.pdf','20000000-0000-0000-0000-000000000001','2026-11-12T09:00:00Z'),
 (640004,'10000000-0000-0000-0000-000000000001',640001,640002,'creatives-dec-v2.zip','application/zip',13002342,'10000000-0000-0000-0000-000000000001/design-compare/creatives-dec-v2.zip','20000000-0000-0000-0000-000000000001','2026-11-13T09:00:00Z')
on conflict do nothing;
insert into public.conversation_attachments(id,company_id,conversation_id,name,content_type,size,path,created_at) overriding system value
values (640005,'10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000003','audiences-oct.csv','text/csv',18432,'10000000-0000-0000-0000-000000000001/conversations/62000000-0000-0000-0000-000000000003/audiences-oct.csv','2026-11-14T16:40:00Z')
on conflict do nothing;

-- Omar's Conversation with Ads in which Ads asks him, with the Engine's own clarify tool, which angle the Meta campaign
-- takes (#138; the reference's th-meta, message m3): his message, and the open question its Run waits on. The Run stays
-- open, as its Connection is never called.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Ads','2026-11-16T10:12:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000001',null,'عمر',
 '@Ads محتاجين حملة Meta لكورس «المحاسب الشامل». الدفعة الجديدة بتبدأ 1 ديسمبر، والميزانية 15,000 ج للشهر. الهدف ليدز على واتساب.',
 '63000000-0000-0000-0000-000000000006','design-compare-fixture-question','2026-11-16T10:12:00Z'
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000005');
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
values ('10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000005','design-compare-fixture-question','design-compare-prompt@1','question','اختار زاوية الإعلان',
 '{"question":"اختار زاوية الإعلان","choices":["من خريج لمحاسب شغال","Excel وOdoo في كورس واحد","شهادة معتمدة وتدريب عملي"],"multiple":false}','open','2026-11-16T10:14:00Z')
on conflict do nothing;

-- Omar's Conversation with Ads in which Ads hands him a step it may not do, publishing the article on WordPress (#139;
-- the reference's th-team, message t10, worded as there): his message, Ads's reply and the open hand card under it.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Ads','2026-11-16T10:38:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000006',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-hand',x.at
from (values
 (1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','المقال بتاع «كورس محاسب شامل اونلاين» خلص؟','63000000-0000-0000-0000-000000000007'::uuid,'2026-11-16T10:38:00Z'::timestamptz),
 (2,'agent',null,'61000000-0000-0000-0000-000000000002','Ads','المقال جاهز مسودة على WordPress. النشر عليك انت:',null,'2026-11-16T10:40:00Z')
) x(n,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000006')
order by x.n;
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
values ('10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000006','design-compare-fixture-hand','call-0','hand','انشر مقال «كورس محاسب شامل اونلاين: هتتعلم إيه وهتشتغل فين»',
 '{"app":"WordPress","line":"SEO سابه مسودة على WordPress، وانت اللي تدوس نشر.","rows":[{"label":"الطول","value":"1,600 كلمة · 5 عناوين فرعية"},{"label":"الروابط","value":"3 روابط لصفحة المحاسب الشامل"},{"label":"المراجعة","value":"Critic: مقبول بعد تعديل واحد"}],"url":"https://rslearning.example/wp-admin/post.php?post=812&action=edit","note":"SEO هيتابع ترتيبه في Search Console."}',
 'open','2026-11-16T10:40:00Z')
on conflict do nothing;

-- The Card sheet's Chat tab (#145): the Card of Omar's chat with Ads above (his own: its chat in the sheet), and the
-- Card of the first Contributor's chat with Ads (another Member's: the lock Omar sees); 640001 above is the idea with Ads
-- and no chat. Tied here as the database ties them (only it may), in the first "In progress" stage.
insert into public.work_cards(id,company_id,stage_id,title,agent_id,conversation_id) overriding system value
select x.id,'10000000-0000-0000-0000-000000000001',s.id,x.title,'61000000-0000-0000-0000-000000000002',x.conversation
from (values (640006,'إعلانات Meta: مراجعة قبل العميل','62000000-0000-0000-0000-000000000003'::uuid),(640007,'إعلانات السعودية بلهجة سعودية','62000000-0000-0000-0000-000000000004'::uuid)) x(id,title,conversation)
cross join lateral (select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind='before_review' order by position,id limit 1) s
on conflict do nothing;

-- Omar's Conversation with Ads whose reply shows the tool calls its Run made (#141; the reference's th-meta, message m3,
-- its four steps and their 41 seconds): his message and Ads's reply. Its steps are read from the Agent's Hermes session
-- when the chat opens (#346), and the fixture has no Engine, so this capture shows the reply without them.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Ads','2026-11-16T10:12:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000007',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-steps',x.at
from (values
 (1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','@Ads محتاجين حملة Meta لكورس «المحاسب الشامل». الدفعة الجديدة بتبدأ 1 ديسمبر، والميزانية 15,000 ج للشهر. الهدف ليدز على واتساب.','63000000-0000-0000-0000-000000000015'::uuid,'2026-11-16T10:12:00Z'::timestamptz),
 (2,'agent',null,'61000000-0000-0000-0000-000000000002','Ads','قريت نتايج آخر 3 حملات للكورس (من أغسطس لأكتوبر):
• 412 ليد بمتوسط 34 ج لليد
• أحسن جمهور: خريجين تجارة من 22 لـ 30 سنة في القاهرة والجيزة والإسكندرية، تكلفة الليد عندهم 27 ج
• الفيديو القصير جاب ليدز أرخص بـ 22% من الصور',null,'2026-11-16T10:14:00Z')
) x(n,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000007')
order by x.n;

-- Omar's Conversation with Ads in which its Run stops to ask before it publishes the article (#163; the reference's
-- th-seo, its pending approval card, worded as there): his message, and the open request its Run waits on, in the
-- Engine's words. The Run stays open, as its Connection is never called.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Ads','2026-11-16T13:30:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000008','person','20000000-0000-0000-0000-000000000001',null,'عمر',
 'المقال بتاع «كورس محاسبة اونلاين» خلص؟ لو تمام انشره.','63000000-0000-0000-0000-000000000016','design-compare-fixture-permission','2026-11-16T13:30:00Z'
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000008');
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
values ('10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000008','design-compare-fixture-permission','design-compare-approval-1','permission','نشر المقال على موقع الأكاديمية',
 '{"description":"نشر المقال على موقع الأكاديمية","command":"wp post edit 812 --post_status=publish","choices":["once","always","deny"]}','open','2026-11-16T13:36:00Z')
on conflict do nothing;

-- Omar's Conversation with Analyst in which it asks for an app it needs for the weekly report (#203; the reference's
-- th-report, message r1, worded as there): his message, Analyst's reply and the connect card under it. The reference's
-- GA4 is not on gtmworks's list of apps, so the card asks for Amplitude, an analytics app that is. The Engine is never
-- read here, so the card is open.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
values ('62000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000004','Analyst','2026-11-16T09:28:00Z')
on conflict (id) do nothing;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
select '10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000009',x.author,x.person_id,x.agent_id,x.author_name,x.body,x.send_key,'design-compare-fixture-connect',x.at
from (values
 (1,'person','20000000-0000-0000-0000-000000000001'::uuid,null::uuid,'عمر','@Analyst ابدأ التقرير الأسبوعي','63000000-0000-0000-0000-000000000017'::uuid,'2026-11-16T09:28:00Z'::timestamptz),
 (2,'agent',null,'61000000-0000-0000-0000-000000000004','Analyst','بدأت التقرير الأسبوعي (5 – 11 نوفمبر). أرقام Meta وGoogle اتجمعت.
لسه ناقصني بيانات المبيعات من GA4، ولو متوصلش لحد الخميس هكتب التقرير بالليدز بس وهوضّح ده في أوله.',null,'2026-11-16T09:30:00Z')
) x(n,author,person_id,agent_id,author_name,body,send_key,at)
where not exists(select 1 from public.conversation_messages where conversation_id='62000000-0000-0000-0000-000000000009')
order by x.n;
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
values ('10000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000009','design-compare-fixture-connect','call-0','connect','Amplitude',
 '{"app":"amplitude","reason":"محتاجه عشان أضيف المبيعات للتقرير الأسبوعي قبل الخميس."}','open','2026-11-16T09:30:00Z')
on conflict do nothing;

commit;
