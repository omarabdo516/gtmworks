begin;
create extension if not exists pgtap with schema extensions;
select plan(37);
insert into public.work_cards(company_id,stage_id,title,next_actor) select company_id,id,'Lessons run A','30000000-0000-0000-0000-000000000001' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and position=1;
insert into public.work_cards(company_id,stage_id,title,next_actor) select company_id,id,'Lessons run B','30000000-0000-0000-0000-000000000001' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and position=1;
select set_config('test.card_a',(select id::text from public.work_cards where title='Lessons run A'),true);
select set_config('test.card_b',(select id::text from public.work_cards where title='Lessons run B'),true);
-- Run keys of the Writer for card A (a1) and card B (a3), the Designer's run key for card A (a2) and a Writer company key (a5).
insert into public.agent_keys(id,company_id,person_id,key_hash,kind,card_id,expires_at) values
 ('b1000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','lessons-writer-run-a','run',current_setting('test.card_a')::bigint,now()+interval '1 hour'),
 ('b1000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','lessons-writer-run-b','run',current_setting('test.card_b')::bigint,now()+interval '1 hour'),
 ('b1000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','lessons-designer-run','run',current_setting('test.card_a')::bigint,now()+interval '1 hour');
insert into public.agent_keys(id,company_id,person_id,key_hash) values ('b1000000-0000-0000-0000-0000000000a5','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','lessons-writer-company-key');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.install_skill('10000000-0000-0000-0000-000000000001','library',E'---\nname: caption-hooks\ndescription: Write hooks\npermissions: cards.read\n---\nOpen with the reader''s problem.');
select public.install_skill('10000000-0000-0000-0000-000000000001','upload',E'---\nname: big-skill\ndescription: Nearly full\npermissions: none\n---\n'||repeat('x',19900));
select public.set_skill_enabled('10000000-0000-0000-0000-000000000001',(select id from public.skills where slug='caption-hooks'),'30000000-0000-0000-0000-000000000001',true);
select public.set_skill_enabled('10000000-0000-0000-0000-000000000001',(select id from public.skills where slug='big-skill'),'30000000-0000-0000-0000-000000000001',true);
-- The Writer proposes from its run on card A.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select is(public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k1','f1',E'Open with the number.\n  Then the problem.','Posts that opened with a number were saved more')->>'status','pending','the Writer proposes a lesson for a skill enabled for it');
select is((select lesson from public.skill_lessons where request_key='k1'),'Open with the number. Then the problem.','a lesson is stored as one line');
select is((select card_id from public.skill_lessons where request_key='k1'),current_setting('test.card_a')::bigint,'the proposal names the card of the run it was learned on');
select is((select reason from public.skill_lessons where request_key='k1'),'Posts that opened with a number were saved more','the proposal keeps its reason');
select is((select base_version from public.skill_lessons where request_key='k1'),1,'the proposal keeps the skill version it was written against');
select is((public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k1','f1','different text','other')->>'id')::bigint,(select id from public.skill_lessons where request_key='k1'),'the same request key returns the first proposal');
select is((select count(*)::int from public.skill_lessons),1,'a repeated request stores nothing more');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k1','f2','x','y')$$,null,'idempotency key reused','the same key with a different request is refused');
select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k2','f3','Never name a price in a hook.','Prices made two captions fail the brand check');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a5','caption-hooks','k3','f4','x','y')$$,'42501',null,'a company key is not a run: it proposes nothing');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a3','caption-hooks','k3','f4','x','y')$$,'42501',null,'a run key of another card is refused when the token names this card');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','no-such-skill','k4','f5','x','y')$$,null,'skill not found','a skill that does not exist is not found');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k5','f6','   ','y')$$,'22023',null,'an empty lesson is refused');
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k6','f7',repeat('x',501),'y')$$,'22023',null,'a lesson over 500 characters is refused');
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),true)$$,'42501',null,'an agent cannot approve a lesson, not even its own');
-- The Designer has no such skill enabled.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000002','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a2','caption-hooks','k7','f8','x','y')$$,null,'skill not found','an agent cannot propose for a skill that is not enabled for it');
-- People: only a manager of this company decides.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),true)$$,'42501',null,'a viewer cannot approve a lesson');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k1'),false)$$,'42501',null,'a reviewer cannot reject a lesson');
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
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','k8','f9','Keep hooks under 12 words.','Long hooks were cut off on phones');
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k8'),true),3,'a second approved lesson makes version 3');
select is((select (length(content)-length(replace(content,'## Lessons','')))/length('## Lessons') from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=3),1,'the Lessons section is made once');
select ok((select position('- Open with the number.' in content)<position('- Keep hooks under 12 words.' in content) from public.skill_versions where skill_id=(select id from public.skills where slug='caption-hooks') and version=3),'lessons are added in the order they are approved');
-- The agent reads the approved lessons; it never reads the rejected one.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select ok((select position('- Keep hooks under 12 words.' in x->>'content')>0 and position('Never name a price' in x->>'content')=0 from jsonb_array_elements(public.agent_load_skills('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1')) x where x->>'slug'='caption-hooks'),'the next run reads the approved lessons and not the rejected one');
-- A lesson that would push the skill past its size limit is not added.
select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','big-skill','k9','f10',repeat('y',100),'Checks the size limit');
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.decide_skill_lesson('10000000-0000-0000-0000-000000000001',(select id from public.skill_lessons where request_key='k9'),true)$$,'22023',null,'a lesson that makes the skill too large is refused');
select is((select status from public.skill_lessons where request_key='k9'),'pending','a refused approval leaves the lesson waiting');
-- At most ten proposals wait for one skill from one agent.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','cap'||n,'f'||n,'Lesson '||n,'Reason '||n) from generate_series(1,10) n;
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','cap11','f11','Lesson 11','Reason 11')$$,'22023',null,'an agent cannot leave more than ten proposals waiting for one skill');
-- Revoking the agent ends proposals, even by calling the database directly.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.revoke_agent_access('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',json_build_object('sub','30000000-0000-0000-0000-000000000001','role','authenticated','run_card',current_setting('test.card_a')::bigint)::text,true);
select throws_ok($$select public.propose_skill_lesson('10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-0000000000a1','caption-hooks','after-revoke','f12','x','y')$$,'42501',null,'a revoked agent cannot propose');
select * from finish();
rollback;
