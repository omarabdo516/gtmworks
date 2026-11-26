import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #873 (spec #866): the Engine knows one identity for everyone who comes through gtmworks's gate, so the Activity log is
// the only record of which Owner did what on the dashboard: one line a visit (a first page loaded; a reload, the
// dashboard's own page changes and its reads write nothing more), one line for each change request, naming the person,
// the page and the kind of change, and saying when the Engine did not take it, and one for each refused action, with
// its page. No line holds a key, a value or any part of
// a request's body. Every line reads in English and in Arabic.
const owner='20000000-0000-0000-0000-000000000001';
const company='10000000-0000-0000-0000-000000000001';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const lines=()=>rows(`select action, details, body from public.company_log where company_id='${company}' and source='engine_dashboard' order by id`)
 .map(row=>({action:row.action,details:typeof row.details==='string'?JSON.parse(row.details):row.details,body:row.body}));

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{ freshSeed(testInfo); fake=await laneHermes(); });
test.afterAll(async()=>{ await fake?.close(); });

// A request the dashboard's own code makes, from its page.
async function ask(page:Page,path:string,{method='GET',body}:{method?:string,body?:unknown}={}) {
 return page.evaluate(async([path,method,body])=>{
  const answer=await fetch(`/c/rs-learning/hermes${path}`,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return answer.status;
 },[path,method,body] as const);
}

test('opening the dashboard is one line a visit, and reading it writes nothing more',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 await page.goto('/c/rs-learning/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 // Its own code reads its status and themes and asks a socket ticket; then a page change, reads, and a reload.
 await expect(page.locator('#engine-socket')).toHaveText('gateway.ready');
 await page.locator('#to-sessions').click();
 await expect(page.locator('#sessions-page')).toBeVisible();
 expect(await ask(page,'/api/status')).toBe(200);
 expect(await ask(page,'/api/env')).toBe(200);
 await page.reload();
 await expect(page.locator('#sessions-page')).toBeVisible();
 expect(lines()).toEqual([{action:'engine_dashboard_opened',details:{private:'owners'},body:null}]);
});

test('each change is one line with the page and the kind, one the Engine did not take says so, and a refused action says it was refused on its page',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 await page.goto('/c/rs-learning/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 const before=lines().length;
 expect(await ask(page,'/api/env',{method:'PUT',body:{key:'OPENROUTER_API_KEY',value:'sk-or-logged-nowhere'}})).toBe(200);
 expect(await ask(page,'/api/dashboard/agent-plugins/install',{method:'POST',body:{identifier:'hermes-plugin-calendar',enable:true}})).toBe(200);
 expect(await ask(page,'/api/config',{method:'PUT',body:{config:{display:{skin:'mono'}}}})).toBe(200);
 expect(await ask(page,'/api/messaging/platforms/telegram',{method:'PUT',body:{enabled:true,env:{TELEGRAM_BOT_TOKEN:'123:telegram-token'}}})).toBe(200);
 expect(await ask(page,'/api/hermes/update',{method:'POST',body:{}})).toBe(403);
 // A change the Engine did not take is a line too, that says it was not taken.
 expect(await ask(page,'/api/webhooks',{method:'POST',body:{name:'Not A Name!'}})).toBe(400);
 const written=lines().slice(before);
 expect(written.map(line=>[line.action,line.details])).toEqual([
  ['engine_dashboard_changed',{page:'keys',change:'keySaved',private:'owners'}],
  ['engine_dashboard_changed',{page:'plugins',change:'pluginInstalled',private:'owners'}],
  ['engine_dashboard_changed',{page:'config',change:'settingSaved',private:'owners'}],
  ['engine_dashboard_changed',{page:'channels',change:'platformSet',private:'owners'}],
  ['engine_dashboard_refused',{page:'system',refused:'hermesUpdate',private:'owners'}],
  ['engine_dashboard_rejected',{page:'webhooks',change:'added',private:'owners'}],
 ]);
 // No line holds a key, a value or a name from a body.
 const all=JSON.stringify(rows(`select * from public.company_log where company_id='${company}' and source='engine_dashboard'`));
 for(const value of ['sk-or-logged-nowhere','OPENROUTER_API_KEY','hermes-plugin-calendar','mono','telegram','123:telegram-token','Not A Name!']) expect(all).not.toContain(value);
});

test('the lines read in English and in Arabic in the Activity log',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/log?who=p:${owner}`);
 const acts=page.locator('.lgp-body .lg-row .lg-act');
 const english=['tried to add something new on the Webhooks page of the Engine dashboard, and it was not taken',
  'tried to update the Engine on the System page of the Engine dashboard and was refused','set up a messaging platform on the Channels page of the Engine dashboard',
  'saved a setting on the Config page of the Engine dashboard','installed a plugin on the Plugins page of the Engine dashboard',
  'saved a key on the Keys page of the Engine dashboard','opened the Engine dashboard'];
 await expect(acts.first()).toBeVisible();
 expect((await acts.allInnerTexts()).slice(0,english.length)).toEqual(english);
 query(`update public.people set language='ar' where id='${owner}'`);
 try {
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  const arabic=['حاول يضيف حاجة جديدة في صفحة Webhooks في لوحة تحكم المحرك، وماتاخدش','حاول يحدّث المحرك في صفحة النظام في لوحة تحكم المحرك واترفض','ظبط منصة رسايل في صفحة Channels في لوحة تحكم المحرك',
   'حفظ إعداد في صفحة الإعدادات في لوحة تحكم المحرك','نزّل إضافة في صفحة المكوِّنات الإضافية في لوحة تحكم المحرك',
   'حفظ مفتاح في صفحة المفاتيح في لوحة تحكم المحرك','فتح لوحة تحكم المحرك'];
  await expect(acts.first()).toHaveText(arabic[0]);
  expect((await acts.allInnerTexts()).slice(0,arabic.length)).toEqual(arabic);
 } finally { query(`update public.people set language='en' where id='${owner}'`); }
});

test('a Manager reads none of the dashboard\'s lines',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/log');
 await expect(page.locator('.lgp-body .lg-row').first()).toBeVisible();
 await expect(page.getByText('Engine dashboard')).toHaveCount(0);
});
