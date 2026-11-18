import { test, expect } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// Companies on the bundled Engine profile share its memory until each has its own Engine home (#2): the Owner of one is
// warned on the Company settings page while another company shares that profile, and only then.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const omar='20000000-0000-0000-0000-000000000001';
const english='Each agent gets its own agent engine profile, with its own memory, once it moves there; until then it shares the company profile with the other agents on it. The agent that was the main agent of a company when the moves began keeps what its agents remembered before, even if another agent is made main later, and an agent moved to its own profile starts with an empty memory. A company still on the shared default profile from an earlier install shares that memory, so an agent can repeat facts from one company to people in another until it moves.';

// What provide_bundled_hermes leaves behind: the bundled Connection, its main agent and the audit row that marks it.
function provideBundled(company:string) {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Lead','General','default')`);
 return ()=>{ query(`delete from public.hermes_agents where id='${agent}'`); };
}

test('the Owner is warned while two companies share the bundled Engine profile, in English and Arabic',async({page})=>{
 const [language]=JSON.parse(query(`select language from public.people where id='${omar}'`)) as {language:string}[];
 const removals:(()=>void)[]=[];
 try {
  query(`update public.people set language='en' where id='${omar}'`);
  removals.push(provideBundled('10000000-0000-0000-0000-000000000002'));
  await signIn(page,'omar@example.com','/c/rs-consultations/settings');
  // The settings overlay opens on its Company section (#26).
  await expect(page.getByRole('heading',{name:'Company',exact:true})).toBeVisible();
  await expect(page.getByText(english)).toHaveCount(0);

  removals.push(provideBundled('10000000-0000-0000-0000-000000000003'));
  await page.reload();
  await expect(page.getByRole('note').filter({hasText:english})).toBeVisible();
  await page.goto('/c/rs-learning/settings');
  // The settings overlay opens on its Company section (#26).
  await expect(page.getByRole('heading',{name:'Company',exact:true})).toBeVisible();
  await expect(page.getByText(english)).toHaveCount(0);

  query(`update public.people set language='ar' where id='${omar}'`);
  await page.goto('/c/aleem/settings');
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.getByRole('note').filter({hasText:'الشركة اللي لسه على البروفايل المشترك من تثبيت قديم بتشارك ذاكرته'})).toBeVisible();
 } finally {
  for(const remove of removals.reverse()) remove();
  query(`update public.people set language='${language.language}' where id='${omar}'`);
 }
});
