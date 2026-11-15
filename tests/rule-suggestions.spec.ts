import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #25, what people see: in a team a direct Conversation says it is private, and worked alone it does not; a
// Contributor's lasting rule says who it was sent to as a suggestion; the Owner approves one and a Manager declines the
// other from "Waiting on you"; the Contributor reads each decision in their Conversation and the Activity log names
// both. The rules are told through agent_save_rule, as closing the run does (the engine side is proven in
// tests/engine-conversation.spec.ts).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const [rsLearning,rsConsultations]=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'];
const [omar,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'];
const id=(n:number)=>`69000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [connection,ads,theirs,elsewhere,alone,omars]=[1,2,3,4,5,6].map(id);
const saudi='From now on, write every Saudi ad in a light Saudi dialect';
const emojis='From now on, no emojis';

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
   ('${connection}','${rsLearning}','${omar}','http://127.0.0.1:9/p/suggest','suggest-ads','no-key','unreachable'),
   ('${elsewhere}','${rsConsultations}','${omar}','http://127.0.0.1:9/p/suggest-alone','suggest-alone','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${ads}','${rsLearning}','${connection}','Ads','Runs the ads.'),('${alone}','${rsConsultations}','${elsewhere}','Ads','Runs the ads.');
  insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${rsLearning}' and removed_at is null and role<>'owner';
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${theirs}','${rsLearning}','${reviewer}','${ads}','Ads'),('${omars}','${rsConsultations}','${omar}','${alone}','Ads');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ('${rsLearning}','${theirs}','person','${reviewer}',null,'مراجع','${saudi}','${id(7)}','suggest-1',now()-interval '10 minutes'),
   ('${rsLearning}','${theirs}','agent',null,'${ads}','Ads','I will write that way in my work with you, and I suggested it for the team.',null,'suggest-1',now()-interval '9 minutes'),
   ('${rsLearning}','${theirs}','person','${reviewer}',null,'مراجع','${emojis}','${id(8)}','suggest-2',now()-interval '8 minutes'),
   ('${rsLearning}','${theirs}','agent',null,'${ads}','Ads','No emojis in my work with you, and I suggested it for the team.',null,'suggest-2',now()-interval '7 minutes'),
   ('${rsConsultations}','${omars}','person','${omar}',null,'عمر','Plan the week','${id(9)}','alone-1',now()-interval '5 minutes');
  perform public.agent_save_rule('${theirs}','suggest-1','call-0','${saudi}');
  perform public.agent_save_rule('${theirs}','suggest-2','call-0','${emojis}');
 end $$;`);
});
test.afterAll(()=>{ query(`update public.companies set work_mode='team' where id='${rsConsultations}'`); });

const suggestion=(page:import('@playwright/test').Page,rule:string)=>page.getByRole('group',{name:'A rule for Ads, told by مراجع'}).filter({hasText:rule});

test('in a team a direct Conversation says it is private; worked alone it does not',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${theirs}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
 await page.goto(`/c/rs-learning/chat/${ads}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
 await page.context().clearCookies();

 query(`update public.companies set work_mode='alone' where id='${rsConsultations}'`);
 await signIn(page,'omar@example.com',`/c/rs-consultations/conversations/${omars}`);
 await expect(page.locator('.turns > li')).not.toHaveCount(0);
 await expect(page.locator('.priv-line')).toHaveCount(0);
 await page.goto(`/c/rs-consultations/chat/${alone}`);
 await expect(page.locator('.empty-chat')).toBeVisible();
 await expect(page.locator('.priv-line')).toHaveCount(0);
 query(`update public.companies set work_mode='team' where id='${rsConsultations}'`);
 await page.goto(`/c/rs-consultations/conversations/${omars}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
});

test('a Contributor\'s rules are sent as suggestions to the Owner and the Manager, under the replies that took them',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${theirs}`);
 const turns=page.locator('.turns > li');
 await expect(turns).toHaveCount(6);
 for(const n of [2,5]) {
  await expect(turns.nth(n)).toHaveAttribute('data-kind','suggested');
  await expect(turns.nth(n)).toHaveText('Sent as a suggestion to عمر and مدير · in “Waiting on you”');
 }
 await page.goto(`/c/rs-learning/settings?agent=${ads}`);
 await expect(page.locator('.rl-row')).toHaveCount(0);
});

test('the Owner makes one team-wide from "Waiting on you"; the Contributor reads it and the log names it',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 await expect(suggestion(page,saudi)).toContainText('Told by مراجع');
 await expect(suggestion(page,saudi).locator('.badge--wait')).toHaveText('Waiting for an OK');
 await expect(suggestion(page,emojis)).toBeVisible();
 await page.goto('/c/rs-learning/settings?section=learning');
 await expect(page.locator('#sov-nav-learning')).toHaveAccessibleName(/^Learning\s*2 waiting for your OK$/);
 await page.goto('/c/rs-learning/approvals');
 await suggestion(page,saudi).getByRole('button',{name:'Make it team-wide'}).click();
 await expect(suggestion(page,saudi)).toHaveCount(0);
 await expect(suggestion(page,emojis)).toBeVisible();
 await page.goto(`/c/rs-learning/settings?agent=${ads}`);
 await expect(page.locator('.rl-row .panel-row__t')).toHaveText([saudi]);
 await expect(page.locator('#sov-nav-learning')).toHaveAccessibleName(/^Learning\s*1 waiting for your OK$/);
 await page.goto('/c/rs-learning/log');
 const approved=page.locator('.lg-body').filter({hasText:'approved what مراجع taught Ads'});
 await expect(approved).toHaveCount(1);
 await expect(approved.locator('.lg-change')).toHaveText('For the whole team');
 await expect(page.locator('.lg-body').filter({hasText:'suggested a rule for the team for Ads'})).toHaveCount(2);
 await page.context().clearCookies();

 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${theirs}`);
 const decided=page.locator('.turns > li[data-kind="decided"]');
 await expect(decided).toHaveCount(1);
 await expect(decided).toHaveAttribute('data-decision','approved');
 await expect(decided).toHaveText(`Savedعمر approved it, now for the whole team: «${saudi}»`);
});

test('a Manager declines the other; the Contributor reads that it stays in their own work, and the log names it',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/approvals');
 await expect(suggestion(page,saudi)).toHaveCount(0);
 await suggestion(page,emojis).getByRole('button',{name:'Decline'}).click();
 await expect(suggestion(page,emojis)).toHaveCount(0);
 await page.goto('/c/rs-learning/settings?section=learning');
 await expect(page.locator('#sov-nav-learning .sov-count')).toHaveCount(0);
 await page.goto('/c/rs-learning/log');
 const declined=page.locator('.lg-body').filter({hasText:'declined a rule مراجع suggested for Ads'});
 await expect(declined).toHaveCount(1);
 await expect(declined.locator('.lg-change')).toHaveText('Stays in their own work only');
 await page.context().clearCookies();

 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${theirs}`);
 const decided=page.locator('.turns > li[data-kind="decided"]');
 await expect(decided).toHaveCount(2);
 await expect(decided.last()).toHaveAttribute('data-decision','declined');
 await expect(decided.last()).toHaveText('مدير didn’t approve it for the team. It stays in your own work only.');
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.lg-body').filter({hasText:'declined a rule مراجع suggested for Ads'})).toHaveCount(1);
 await page.context().clearCookies();

 await signIn(page,'multi@example.com','/c/rs-learning/log');
 await expect(page.locator('.lg-body').filter({hasText:'approved what مراجع taught Ads'})).toHaveCount(1);
 await expect(page.locator('.lg-body').filter({hasText:'suggested a rule for the team for Ads'})).toHaveCount(0);
});
