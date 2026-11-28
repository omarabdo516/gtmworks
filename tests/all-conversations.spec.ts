import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const lead='a6730000-0000-0000-0000-000000000001';

const profile=`co-${company.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;
test.afterAll(async()=>{ await fake?.close(); });

// Sixty of the Owner's Conversations with Lead, each its own Engine session on Lead's profile (#883), the first begun
// first and the rest an hour apart, and one of the Manager's. The oldest is answered last, so it holds the newest
// message of all.
async function sixtyConversations() {
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const now=Math.floor(Date.now()/1000);
 const id=(g:number|string)=>`c6730000-0000-0000-0000-${String(g).padStart(12,'0')}`;
 for(let g=1;g<=60;g++) {
  const at=now-100*3600+g*3600;
  const words=g===7?'مُــهمّة إعلانات ديسمبر':`Plan number ${String(g).padStart(2,'0')}`;
  fake.settings.sessions.set(`session-${id(g)}`,{profile,messages:[{role:'user',content:words,timestamp:at},...(g===1?[{role:'assistant',content:'The answer to the oldest',timestamp:now-60}]:[])]});
 }
 fake.settings.sessions.set(`session-${id('ff')}`,{profile,messages:[{role:'user',content:'The Manager\'s own plan',timestamp:now-60}]});
 // The general channel, with no message yet, sorts by the time it was made: set from the test's own clock, between
 // the oldest's answer and Conversation 60, however old the lane's seed is.
 query(`update public.channels set created_at=now()-interval '20 hours' where company_id='${company}' and kind='general'`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','f6730000-0000-0000-0000-000000000001','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,created_at)
  select ('c6730000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'${company}','${owner}','${lead}','Lead','session-c6730000-0000-0000-0000-'||lpad(g::text,12,'0'),now()-interval '100 hours'+make_interval(hours=>g) from generate_series(1,60) g`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${id('ff')}','${company}','${manager}','${lead}','Lead','session-${id('ff')}')`);
}
async function ownerSignIn(page:Page,path:string) {
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com',path);
}

test('A person reaches every Conversation of theirs from the sidebar, newest message first, a page at a time, and finds one by its title in Arabic',async({page})=>{
 test.setTimeout(90000);
 await sixtyConversations();
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
 // The general channel, with no message yet, by the time it was made (20 hours ago).
 await expect(rows.nth(1)).toContainText('#general');
 await expect(rows.nth(2)).toContainText('Plan number 60');
 await expect(page.getByRole('button',{name:'Current 61'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Show more'}).click();
 await expect(rows).toHaveCount(61);
 await expect(page.getByRole('button',{name:'Show more'})).toHaveCount(0);
 await expect(rows.filter({hasText:'#general'})).toHaveCount(1);
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
