import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const lead='a6730000-0000-0000-0000-000000000001';

// Sixty of the Owner's Conversations with Lead, the first written first and the rest an hour apart, and one of the
// Manager's. The oldest is answered last, so it holds the newest message of all.
function sixtyConversations() {
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','f6730000-0000-0000-0000-000000000001','Lead','General',true,'default')`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at)
  select ('c6730000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'${company}','${owner}','${lead}','Lead',now()-interval '100 hours'+make_interval(hours=>g) from generate_series(1,60) g`);
 query(`insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,run_id,send_key,created_at)
  select company_id,id,'person',person_id,'Omar',case when id='c6730000-0000-0000-0000-000000000007' then 'مُــهمّة إعلانات ديسمبر' else 'Plan number '||right(id::text,2) end,'r'||id,gen_random_uuid(),created_at
  from public.conversations where person_id='${owner}' and company_id='${company}'`);
 query(`insert into public.conversation_messages(company_id,conversation_id,author,author_name,body,run_id,created_at)
  values ('${company}','c6730000-0000-0000-0000-000000000001','agent','Lead','The answer to the oldest','r1',now()-interval '1 minute')`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('c6730000-0000-0000-0000-0000000000ff','${company}','${manager}','${lead}','Lead')`);
 query(`insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,run_id,send_key)
  values ('${company}','c6730000-0000-0000-0000-0000000000ff','person','${manager}','مدير','The Manager''s own plan','rff',gen_random_uuid())`);
}
async function ownerSignIn(page:Page,path:string) {
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com',path);
}

test('A person reaches every Conversation of theirs from the sidebar, newest message first, a page at a time, and finds one by its title in Arabic',async({page})=>{
 test.setTimeout(90000);
 sixtyConversations();
 await ownerSignIn(page,'/c/rs-learning/home');
 // The sidebar keeps its twenty, the newest message first: the oldest Conversation, answered a minute ago, leads.
 const recents=page.locator('#sb-recent .thread-item:not(.ch-item)');
 await expect(recents).toHaveCount(20);
 await expect(recents.first()).toHaveText(/Plan number 01/);
 await expect(recents.nth(1)).toHaveText(/Plan number 60/);
 await page.locator('#sb-recent').getByRole('link',{name:'All conversations'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations$/);
 await expect(page.getByRole('heading',{name:'All conversations'})).toBeAttached();
 const rows=page.locator('.cv-list .cv-row');
 // A page of fifty, then the rest: the sixty and the general channel the Owner is in; never the Manager's.
 await expect(rows).toHaveCount(50);
 await expect(rows.first()).toContainText('Plan number 01');
 await expect(rows.first()).toContainText('The answer to the oldest');
 await expect(rows.nth(1)).toContainText('Plan number 60');
 await expect(page.getByRole('button',{name:'Current 61'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Show more'}).click();
 await expect(rows).toHaveCount(61);
 await expect(page.getByRole('button',{name:'Show more'})).toHaveCount(0);
 await expect(rows.filter({hasText:'General'})).toHaveCount(1);
 await expect(page.locator('.cv-list')).not.toContainText('The Manager');
 // The search reads every title, not only the rows shown, as the product's search reads Arabic.
 await page.getByRole('button',{name:'Search conversations'}).click();
 await page.getByRole('searchbox',{name:'Search conversations'}).fill('مهمه اعلانات');
 await expect(rows).toHaveCount(1);
 await expect(rows.first()).toContainText('مُــهمّة إعلانات ديسمبر');
 await page.getByRole('searchbox',{name:'Search conversations'}).fill('nothing like this');
 await expect(page.getByText('No conversation matches “nothing like this”')).toBeVisible();
 await page.getByRole('searchbox',{name:'Search conversations'}).fill('مهمه');
 await rows.first().getByRole('link').click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/c6730000-0000-0000-0000-000000000007$/);
 // The Archived list holds nothing yet.
 await page.goto('/c/rs-learning/conversations?tab=archived');
 await expect(page.getByRole('button',{name:'Archived 0'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('No archived conversations')).toBeVisible();
});
