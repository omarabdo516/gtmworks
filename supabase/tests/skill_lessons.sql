begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
insert into public.work_cards(company_id,stage_id,title,next_actor) select company_id,id,'Lessons run A','30000000-0000-0000-0000-000000000001' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and position=1;
insert into public.work_cards(company_id,stage_id,title,next_actor) select company_id,id,'Lessons run B','30000000-0000-0000-0000-000000000001' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and position=1;
select set_config('test.card_a',(select id::text from public.work_cards where title='Lessons run A'),true);
select set_config('test.card_b',(select id::text from public.work_cards where title='Lessons run B'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.install_skill('10000000-0000-0000-0000-000000000001','library',E'---\nname: caption-hooks\ndescription: Write hooks\npermissions: cards.read\n---\nOpen with the reader''s problem.');
select public.install_skill('10000000-0000-0000-0000-000000000001','upload',E'---\nname: big-skill\ndescription: Nearly full\npermissions: none\n---\n'||repeat('x',19900));
select public.set_skill_enabled('10000000-0000-0000-0000-000000000001',(select id from public.skills where slug='caption-hooks'),'30000000-0000-0000-0000-000000000001',true);
select public.set_skill_enabled('10000000-0000-0000-0000-000000000001',(select id from public.skills where slug='big-skill'),'30000000-0000-0000-0000-000000000001',true);
-- Lessons the Writer's run on card A left before the external-agent API was removed (#341).
reset role;
insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint)
 select '10000000-0000-0000-0000-000000000001',s.id,current_setting('test.card_a')::bigint,'30000000-0000-0000-0000-000000000001',l.lesson,l.reason,1,l.k,'f-'||l.k
 from (values
 ('k1','caption-hooks','Open with the number. Then the problem.','Posts that opened with a number were saved more'),
 ('k2','caption-hooks','Never name a price in a hook.','Prices made two captions fail the brand check')) l(k,slug,lesson,reason) join public.skills s on s.company_id='10000000-0000-0000-0000-000000000001' and s.slug=l.slug;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),true)$$,'42501',null,'an agent cannot approve a lesson, not even its own');
-- People: only a manager of this company decides.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),true)$$,'42501',null,'a viewer cannot approve a lesson');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),false)$$,'42501',null,'a Contributor cannot reject a lesson');
select throws_ok($$insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint) select company_id,skill_id,card_id,proposed_by,'x','y',1,'direct','z' from public.skill_lessons limit 1$$,'42501',null,'clients cannot write lessons directly');
select throws_ok($$update public.skill_lessons set status='approved'$$,'42501',null,'clients cannot decide a lesson by updating it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000003',(select id from public.skill_lessons where request_key='k1'),true)$$,'42501',null,'a manager of another company cannot approve it');
select is(public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k2'),false),null,'a manager rejects a lesson');
select is((select count(*)::int from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks')),1,'a rejected lesson adds nothing to the skill');
select is((select status||':'||decided_by::text from public.skill_lessons where request_key='k2'),'rejected:20000000-0000-0000-0000-000000000002','the rejection keeps who decided');
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k2'),true)$$,'22023',null,'a rejected lesson cannot be approved afterwards');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),true),2,'the owner approves a lesson and the skill gets its next version');
select is((select status||':'||result_version::text from public.skill_lessons where request_key='k1'),'approved:2','the approval keeps the version it made');
select ok((select content from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=2) like E'%Open with the reader''s problem.\n\n## Lessons\n\n- Open with the number. Then the problem.\n','the approved lesson is the last bullet of a new Lessons section');
select is((select count(*)::int from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=1 and content=E'---\nname: caption-hooks\ndescription: Write hooks\npermissions: cards.read\n---\nOpen with the reader''s problem.'),1,'the earlier version is kept as it was');
select is((select sha256 from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=2),(select encode(sha256(convert_to(content,'UTF8')),'hex') from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=2),'the new version carries the digest of its text');
-- A second lesson joins the same section.
reset role;
insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint)
 select '10000000-0000-0000-0000-000000000001',s.id,current_setting('test.card_a')::bigint,'30000000-0000-0000-0000-000000000001',l.lesson,l.reason,1,l.k,'f-'||l.k
 from (values
 ('k8','caption-hooks','Keep hooks under 12 words.','Long hooks were cut off on phones')) l(k,slug,lesson,reason) join public.skills s on s.company_id='10000000-0000-0000-0000-000000000001' and s.slug=l.slug;
set local role authenticated;
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k8'),true),3,'a second approved lesson makes version 3');
select is((select (length(content)-length(replace(content,'## Lessons','')))/length('## Lessons') from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=3),1,'the Lessons section is made once');
select ok((select position('- Open with the number.' in content)<position('- Keep hooks under 12 words.' in content) from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=3),'lessons are added in the order they are approved');
-- A lesson that would push the skill past its size limit is not added.
reset role;
insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint)
 select '10000000-0000-0000-0000-000000000001',s.id,current_setting('test.card_a')::bigint,'30000000-0000-0000-0000-000000000001',l.lesson,l.reason,1,l.k,'f-'||l.k
 from (values
 ('k9','big-skill','yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy','Checks the size limit')) l(k,slug,lesson,reason) join public.skills s on s.company_id='10000000-0000-0000-0000-000000000001' and s.slug=l.slug;
set local role authenticated;
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k9'),true)$$,'22023',null,'a lesson that makes the skill too large is refused');
select is((select status from public.skill_lessons where request_key='k9'),'pending','a refused approval leaves the lesson waiting');
select * from finish();
rollback;
