import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { serverLogOf } from './lane.mjs';
import { i18n } from '../lib/i18n.mjs';

// Settings never waits on the Engine (#898, ADR 0030). The fake Engine holds every management read four seconds (the
// issue's five, less a second: a call's own deadline is five, lib/engine/transport.mjs, and a read held past it is an
// Engine that did not answer, not one that answered late): each Settings page still draws what gtmworks stores with a
// first byte under half a second, each part the Engine backs says it is being read, and fills in when its read lands.
// One page never has more than four Engine reads open at once.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const co=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const held=4000;
const en=i18n('en').t;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(co,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},
  display_name:'Lead',description:'Runs the team.',description_auto:false,bot_title:'Marketing lead'});
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','Marketing lead',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','${co}',true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterEach(()=>{ fake.settings.managedDelay=null; });
test.afterAll(async()=>{ await fake?.close(); });

// The page's own request: when its first byte left the server, in ms from the request's start.
async function firstByte(page:Page,address:string) {
 const response=await page.goto(address);
 expect(response?.ok(),address).toBe(true);
 const timing=response!.request().timing();
 return timing.responseStart-timing.requestStart;
}
// The most Engine-backed reads of Settings open at once in one page load: a load drops what the page before it left open.
function countOpen(page:Page) {
 const open=new Set<unknown>(); const seen={most:0};
 const part=(url:string)=>url.includes('/api/settings-parts?')||/\/api\/company-apps\?.*test=/.test(url)||/\/api\/(voice-settings|agent-memory)\?/.test(url);
 page.on('framenavigated',frame=>{ if(frame===page.mainFrame()) open.clear(); });
 page.on('request',request=>{ if(part(request.url())) { open.add(request); seen.most=Math.max(seen.most,open.size); } });
 const done=(request:unknown)=>{ open.delete(request); };
 page.on('requestfinished',done); page.on('requestfailed',done);
 return seen;
}

// Each page, what gtmworks stores that it draws at once, and what fills in once the Engine answers.
const pages:{name:string,address:string,stored:(page:Page)=>ReturnType<Page['locator']>,filled:(page:Page)=>ReturnType<Page['locator']>}[]=[
 {name:'an Agent\'s page',address:`/c/rs-learning/settings?agent=${lead}`,stored:page=>page.locator('#set-name-val'),filled:page=>page.locator('#set-desc')},
 {name:'Company',address:'/c/rs-learning/settings?section=company',stored:page=>page.locator('#co-name'),filled:page=>page.locator('#co-tools')},
 {name:'Models',address:'/c/rs-learning/settings?section=models',stored:page=>page.locator('#sov-h'),filled:page=>page.locator('section[aria-labelledby="md-h-stt"]')},
 {name:'Usage',address:'/c/rs-learning/settings?section=usage',stored:page=>page.locator('#use-p-7'),filled:page=>page.locator('.sov .panel-empty',{hasText:en('usageNone')}).or(page.locator('.use-kpis'))},
 {name:'Learning',address:'/c/rs-learning/settings?section=learning',stored:page=>page.locator('#sov-h'),filled:page=>page.locator('section[aria-labelledby="ln-h-rules"]')},
 {name:'Routines',address:'/c/rs-learning/settings?section=routines',stored:page=>page.locator('#sov-h'),filled:page=>page.locator('#sov-h')},
 {name:'Company knowledge',address:'/c/rs-learning/settings?section=knowledge',stored:page=>page.locator('#know-tab-voice'),filled:page=>page.locator('#know-h')},
 {name:'Apps',address:'/c/rs-learning/settings?section=apps',stored:page=>page.locator('#sov-h'),filled:page=>page.locator('#apps-q')},
];

test('with every management read held four seconds, each Settings page draws at once and fills in when the Engine answers',async({page})=>{
 test.setTimeout(240000);
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=account');
 fake.settings.managedDelay=method=>method==='GET'?held:null;
 const open=countOpen(page);
 const reading=page.locator('.sov').getByText(en('settingsPartReading'),{exact:true});
 for(const each of pages) {
  const before=Date.now();
  const ms=await firstByte(page,each.address);
  expect(ms,`${each.name}: first byte`).toBeLessThan(500);
  await expect(each.stored(page),`${each.name}: what gtmworks stores`).toBeVisible();
  expect(Date.now()-before,`${each.name}: drawn without the Engine`).toBeLessThan(held);
  // Each part the Engine backs says it is being read, and takes its line's place once its read lands.
  if(each.name!=='Company') await expect(reading.first(),`${each.name}: reading`).toBeVisible();
  await expect(reading,`${each.name}: filled in`).toHaveCount(0,{timeout:60000});
  await expect(each.filled(page).first()).toBeVisible();
 }
 expect(open.most,'Engine reads open at once on one page').toBeLessThanOrEqual(4);
 expect(open.most).toBeGreaterThan(0);
});

test('an open of an Agent\'s page fills in its About from the Engine, and the server writes its settings_opened line',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${lead}`);
 await expect(page.locator('#set-desc')).toHaveValue('Runs the team.',{timeout:20000});
 const lines=async()=>(await readFile(serverLogOf(),'utf8').catch(()=>'')).split('\n').filter(entry=>entry.includes('"settings_opened"')&&entry.includes(company))
  .map(entry=>JSON.parse(entry.slice(entry.indexOf('{'))) as {section:string,render:string,ms:Record<string,number>});
 await expect.poll(async()=>(await lines()).some(entry=>entry.section==='agents'&&entry.render==='open'&&entry.ms.firstByte>=0&&entry.ms.done>=entry.ms.firstByte),{timeout:10000}).toBe(true);
});
