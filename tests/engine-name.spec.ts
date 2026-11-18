import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';

// A person never reads the Engine's name (#286), in either language: not in the interface, and not in the seed's
// agents shown in the sidebar. Aleem gets a connected profile and a shared space (#122) below; RS Learning is walked as
// the seed and the earlier tests leave it.
const company='10000000-0000-0000-0000-000000000003';
const owner='20000000-0000-0000-0000-000000000001';
const pages=['/c/aleem/home','/c/aleem/agents','/c/aleem/usage','/c/rs-learning/agents'];
// A file path: home-relative, absolute under a home or system folder, a Windows drive, or inside a dot-folder such as
// .config/. A URL, a version such as 0.23.0 and a fraction such as 1/2 are not paths.
const filePath=/~\/|(?:^|[\s"'(=])(?:\/(?:home|root|Users|opt|var|etc|usr|tmp|data|srv|mnt)\/|[A-Za-z]:\\|\.[A-Za-z][\w-]*\/)/m;
// A Company's shared space in the Engine (#122).
const spaceName=/cs-[0-9a-f]{32}/;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Everything a person can read or hear: the title, the visible text, and labels, placeholders and tooltips.
const readable=(page:Page)=>page.evaluate(()=>[document.title,document.body.innerText,
 ...[...document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')].flatMap(element=>['aria-label','placeholder','title','alt'].map(name=>element.getAttribute(name)||''))].join('\n'));

test('page titles, the sidebar, Agent pages and the settings overlay never name the Engine, in English or Arabic, and the overlay shows no file path',async({page})=>{
 const agent=randomUUID(), conversation=randomUUID();
 // The settings overlay (#26): its Company section, its Agents and the main Agent's page.
 const overlay=['/c/aleem/settings','/c/aleem/settings?section=agents',`/c/aleem/settings?agent=${agent}`];
 for(const [sample,isPath] of [['~/.hermes/config.yaml',true],['/opt/data/profiles/co-1',true],['C:\\Users\\omar',true],['1/2',false],['0.23.0',false],['http://localhost',false]] as const) expect(filePath.test(sample),sample).toBe(isPath);
 // A main agent on a profile, so the agent rows are on screen too.
 query(`insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${agent}','${company}','Lead','General',true,'engine-name')`);
 query(`insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/cs-${company.replaceAll('-','')}/skills')`);
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${owner}','${agent}','Lead')`);
 try {
  query(`update public.people set language='en' where id='${owner}'`);
  // Omar is the Owner of Aleem and RS Learning, so he sees their Agent screens.
  await signIn(page,'omar@example.com','/c/aleem/home');
  for(const language of ['en','ar'] as const) {
   query(`update public.people set language='${language}' where id='${owner}'`);
   for(const path of [...pages,...overlay]) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    if(path==='/c/aleem/agents') await expect(page.locator('.company-hermes-agents').getByText('Lead',{exact:true})).toBeVisible();
    if(path===overlay[2]) await expect(page.locator('#set-name-val')).toContainText('Lead');
    const text=await readable(page);
    expect(text.length,`${language} ${path}`).toBeGreaterThan(0);
    expect(text,`${language} ${path}`).not.toMatch(/hermes|هيرمس|هرمس/i);
    if(overlay.includes(path)) expect(text,`${language} ${path}`).not.toMatch(filePath);
    expect(await page.content(),`${language} ${path}`).not.toMatch(spaceName);
   }
  }
  // What the Conversation reads: the composer's Agents and the Conversation's record.
  for(const read of [`/api/conversations?company=${company}`,`/api/conversations?company=${company}&conversation=${conversation}`]) {
   const answer=await page.request.get(read);
   expect(answer.status(),read).toBe(200);
   expect(await answer.text(),read).not.toMatch(spaceName);
  }
 } finally {
  query(`update public.people set language='en' where id='${owner}'`);
  query(`delete from public.conversations where id='${conversation}'`);
  query(`delete from public.company_shared_spaces where company_id='${company}'`);
  query(`delete from public.hermes_agents where id='${agent}'`);
 }
});
