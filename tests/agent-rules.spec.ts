import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #18, what people see when an Owner tells an Agent a lasting rule: the saved line in the Conversation, the rule on the
// Agent's page, its line in the Activity log, and its removal by an Owner or a Manager only. The rules are saved through
// agent_save_rule, as closing the run does (the engine side is proven in tests/engine-conversation.spec.ts): one under
// Ads's reply, and one from a run whose reply was nothing but the call, so it closed failed.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const id=(n:number)=>`67000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [connection,ads,conversation]=[1,2,3].map(id);
const rule='من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
const later='From now on, answer every comment within the day';
const label=(text:string)=>`Remove the rule: ${text.length>40?`${text.slice(0,40)}…`:text}`;

test.describe.configure({mode:'serial'});
test.use({timezoneId:'UTC'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${ads}','${company}','${connection}','Ads','Runs the ads.','rules-ads');
  insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${company}' and removed_at is null and role<>'owner';
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${ads}','Ads');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id) values
   ('${company}','${conversation}','person','${omar}',null,'Omar','${rule}','${id(4)}','rule-run-1'),
   ('${company}','${conversation}','agent',null,'${ads}','Ads','تمام يا عمر. من دلوقتي أي حاجة رايحة لعميل هجهّزها وأستناك تشوفها الأول.',null,'rule-run-1'),
   ('${company}','${conversation}','person','${omar}',null,'Omar','${later}','${id(5)}','rule-run-2');
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome) values ('${company}','${conversation}','rule-run-2','failed');
  perform public.agent_save_rule('${conversation}','rule-run-1','call-0','${rule}');
  perform public.agent_save_rule('${conversation}','rule-run-2','call-0','${later}');
  update public.agent_rules set said_at=said_at+interval '1 minute' where run_id='rule-run-2';
 end $$;`);
});

const agentPage=`/c/rs-learning/settings?agent=${ads}`;
const rows=(page:import('@playwright/test').Page)=>page.locator('.rl-row');

test('the Conversation shows the saved line under the reply, and alone after a reply that was only the call',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 const turns=page.locator('.turns > li');
 await expect(turns).toHaveCount(5);
 await expect(turns.nth(1)).toHaveAttribute('data-author','agent');
 for(const n of [2,4]) {
  await expect(turns.nth(n)).toHaveAttribute('data-kind','saved');
  await expect(turns.nth(n).locator('.note__saved')).toHaveText('Saved');
  await expect(turns.nth(n)).toContainText('A rule for Ads · written in the log');
 }
 await turns.nth(2).getByRole('link',{name:'See it'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/settings\\?agent=${ads}$`));
 await expect(page.locator('#rl-h-t')).toHaveText('Rules it was told 2');
 await expect(rows(page).locator('.panel-row__t')).toHaveText([later,rule]);
 await expect(rows(page).last().locator('.panel-row__t')).toHaveAttribute('dir','auto');
 await expect(rows(page).first().locator('.rl-said')).toHaveText(/^Said by you · Today · \d{1,2}:\d{2}/);
 // How to change Ads is the rules' optional help (#614), behind their "i".
 await expect(page.locator('#rl-h-info')).toBeHidden();
 await page.getByRole('button',{name:'More about Rules it was told'}).click();
 await expect(page.locator('#rl-h-info')).toContainText('It’s saved here and written in the log.');
});

test('the Activity log says who told Ads each rule',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/log');
 const line=page.locator('.lg-body').filter({hasText:'saved a new rule for Ads'});
 await expect(line).toHaveCount(2);
 await expect(line.filter({hasText:rule}).locator('.lg-change')).toHaveText('In the chat · in effect now');
});

test('a Contributor and a Viewer read the rules with no Remove',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await signIn(page,email,agentPage);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().locator('.rl-said')).toHaveText(/^Said by عمر · /);
  await expect(page.getByRole('button',{name:/^Remove the rule/})).toHaveCount(0);
  await page.context().clearCookies();
 }
});

test('an Owner removes a rule and a Manager the other; both removals are logged and the saved lines stay',async({page})=>{
 await signIn(page,'omar@example.com',agentPage);
 await page.getByRole('button',{name:label(later)}).click();
 await expect(rows(page).locator('.panel-row__t')).toHaveText([rule]);
 await expect(page.getByRole('button',{name:/^Remove the rule/})).toBeFocused();
 await page.context().clearCookies();

 await signIn(page,'manager@example.com',agentPage);
 await page.getByRole('button',{name:label(rule)}).click();
 await expect(rows(page)).toHaveCount(0);
 await expect(page.locator('.sov-rules .panel-empty')).toHaveText('Nobody has told it a rule yet. Write “من دلوقتي…” in its chat and it’s saved here.');
 await expect(page.locator('#rl-h')).toBeFocused();
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.lg-body').filter({hasText:'removed a rule from Ads'})).toHaveCount(2);
 await page.context().clearCookies();

 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.turns > li[data-kind="saved"]')).toHaveCount(2);
 await expect(page.locator('.note__link')).toHaveCount(0);
});
