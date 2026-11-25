import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #712: the "Agent's screen" card in an Agent's details shows its real Screen, read through gtmworks from the fake
// Engine: Asleep with "Wake it", Waking up while the start is on its way, then Awake with its picture and "Watch", which
// opens the large view whose picture keeps refreshing; the close button, Escape and the backdrop close it and hand the
// keyboard back to the card. A refused start says why in one line and stays asleep. A Viewer watches but never wakes; a
// Member the Agent is hidden from finds nothing; a wake is one row of the Company log. No page and no answer names the
// Engine or its address, and every picture comes from gtmworks's own address.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const ads=randomUUID(); const adsProfile=`ag-${ads.replaceAll('-','')}`;
const seo=randomUUID(); const seoProfile=`ag-${seo.replaceAll('-','')}`;
const contributor='20000000-0000-0000-0000-000000000003', viewer='20000000-0000-0000-0000-000000000004';
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [adsProfile,seoProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 // A start takes a moment on the Engine, as the desktop comes up.
 fake.settings.screenStartDelay=1200;
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}'),('${seo}','${company}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${company}','Ads','Runs the ads.',false,'${adsProfile}'),
    ('${seo}','${company}','Seo','Writes for search.',false,'${seoProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${companyProfile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values
    ('${company}','${contributor}','${ads}'),('${company}','${contributor}','${seo}'),('${company}','${viewer}','${ads}');
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

async function openScreen(page:Page,email:string,{id=ads,name='Ads'}={}) {
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${id}`);
 const details=page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
 await expect(details).toBeVisible();
 const card=details.locator('section.dp-sec').filter({has:page.getByRole('heading',{name:/^Agent’s screen/})});
 return {details,card};
}
// The picture the view draws: its address, and the grab it is (each grab names itself in its JPEG comment).
const shown=(page:Page,where:string)=>page.locator(`${where} img.scr__shot`).evaluate(async(image:HTMLImageElement)=>{
 const bytes=new Uint8Array(await (await fetch(image.src)).arrayBuffer());
 return {src:image.src,grab:new TextDecoder().decode(bytes.subarray(6,6+bytes[5]-2))};
});

test('the Owner wakes an Agent\'s Screen from its card, watches it refresh in the large view, and closes the view three ways',async({page})=>{
 const asked:string[]=[]; page.on('request',request=>asked.push(request.url()));
 const {card}=await openScreen(page,'omar@example.com');
 // Asleep: the state beside the heading, the asleep frame, and on pointing the one action and the reference's line.
 await expect(card.getByRole('heading')).toHaveText('Agent’s screenAsleep');
 await expect(card.locator('.scr__off')).toHaveText('Screen is asleep');
 const wake=card.getByRole('button',{name:'Wake it',exact:true});
 await wake.hover();
 await expect(card.locator('.scr-ov')).toHaveCSS('opacity','1');
 await expect(card.locator('.scr-ov__pill')).toHaveText('Wake it');
 await expect(card.locator('.scr-ov__line')).toHaveText('Asleep · wakes up on its own when it has work');

 // Wake it: Waking up while the Engine starts it, then Awake with the Engine's own picture, and the reference's toast.
 await wake.click();
 await expect(card.locator('.scr-st')).toHaveText('Waking up');
 await expect(card.locator('.scr__off--waking')).toContainText('Waking up…');
 await expect(card.locator('.scr-st')).toHaveText('Awake');
 await expect(page.locator('.toast')).toContainText('Ads’s screen is awake');
 await expect(card.locator('img.scr__shot')).toBeVisible();
 expect(fake.settings.screenCalls.filter(call=>call.method==='display.start').map(call=>call.params.profile)).toEqual([adsProfile]);
 // The wake is one row of the Company log, with the person and the Agent.
 const woke=rows(`select actor_id,details->>'agent_name' as agent from public.company_log where agent_id='${ads}' and action='agent_screen_woken'`);
 expect(woke).toEqual([{actor_id:'20000000-0000-0000-0000-000000000001',agent:'Ads'}]);

 // Watch opens the large view with the keyboard on its first action (here its close button), and its picture refreshes
 // without a reload: a later grab replaces the first.
 const watch=card.getByRole('button',{name:'Watch',exact:true});
 await watch.click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view).toBeVisible();
 await expect(view.getByRole('button',{name:'Close the screen'})).toBeFocused();
 await expect(view.locator('.vw-chip')).toHaveText('Watching');
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyYour mouse and keyboard are locked, and Ads is working on its own.');
 await expect(view.locator('img.scr__shot')).toBeVisible();
 const first=await shown(page,'dialog.viewer');
 await expect.poll(async()=>(await shown(page,'dialog.viewer')).grab,{timeout:5000}).not.toBe(first.grab);
 expect(first.src).toMatch(/^blob:/);

 // The close button, Escape and a press on the backdrop each close it, and the keyboard goes back to the card.
 await view.getByRole('button',{name:'Close the screen'}).click();
 await expect(view).toBeHidden();
 await expect(watch).toBeFocused();
 await watch.press('Enter');
 await expect(view).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(view).toBeHidden();
 await expect(watch).toBeFocused();
 await expect(page.getByRole('complementary',{name:'Details: Ads',exact:true})).toBeVisible();
 await watch.press('Enter');
 await expect(view).toBeVisible();
 await page.mouse.click(8,8);
 await expect(view).toBeHidden();
 await expect(watch).toBeFocused();

 // Everything came from gtmworks: no request left for the Engine, and no page or answer names it or its address.
 const origin=new URL(page.url()).origin;
 expect(asked.filter(url=>url.includes('agent-screen')).every(url=>url.startsWith(`${origin}/api/agent-screen`))).toBe(true);
 expect(asked.some(url=>url.startsWith(fake.address)||url.startsWith(fake.managementAddress))).toBe(false);
 const html=await page.content();
 for(const leak of [fake.address,fake.managementAddress,new URL(fake.managementAddress).host,adsProfile]) expect(html).not.toContain(leak);
 const state=await page.request.get(`/api/agent-screen?company=${company}&agent=${ads}`);
 expect(await state.json()).toEqual({screen:{state:'awake',control:'agent',refusal:null}});
 const picture=await page.request.get(`/api/agent-screen/picture?company=${company}&agent=${ads}`);
 expect(picture.headers()['content-type']).toBe('image/jpeg');
 expect(picture.headers()['cache-control']).toBe('no-store');
});

test('a Screen that falls asleep while watched is woken from the view\'s asleep block',async({page})=>{
 const {card}=await openScreen(page,'omar@example.com');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view.locator('img.scr__shot')).toBeVisible();
 // The Engine put it to sleep: the next picture says so, and the view shows the asleep block with the real idle time.
 fake.settings.screens.set(adsProfile,{running:false});
 await expect(view.locator('.vw-off p')).toHaveText('The screen goes to sleep after 30 idle minutes, and wakes up on its own when Ads has work.');
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyNothing is running on the screen right now.');
 await view.getByRole('button',{name:'Wake it',exact:true}).click();
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyThe screen is waking up and opening the browser.');
 await expect(view.locator('img.scr__shot')).toBeVisible();
 await expect(view.getByRole('button',{name:'Close the screen'})).toBeFocused();
 await expect(card.locator('.scr-st')).toHaveText('Awake');
 await expect(page.locator('.toast')).toContainText('Ads’s screen is awake');
 expect(rows(`select count(*)::int as n from public.company_log where agent_id='${ads}' and action='agent_screen_woken'`)[0].n).toBe(2);
});

test('a start that is refused says why in one line and the Screen stays asleep',async({page})=>{
 // Ads holds the Company's one display: Seo's start is refused at once, naming the Agent on it.
 const {card}=await openScreen(page,'reviewer@example.com',{id:seo,name:'Seo'});
 await expect(card.locator('.scr-st')).toHaveText('Asleep');
 await card.getByRole('button',{name:'Wake it',exact:true}).click();
 await expect(card.locator('.scr-err')).toHaveText('Ads is using the screen now. Try again once it goes to sleep.');
 await expect(card.locator('.scr-st')).toHaveText('Asleep');
 // Once Ads sleeps, a start the Engine itself refuses (the sandbox lacks what the desktop needs) says that.
 fake.settings.screens.set(adsProfile,{running:false});
 fake.settings.screens.set(seoProfile,{missing:['Xvnc']});
 await card.getByRole('button',{name:'Wake it',exact:true}).click();
 await expect(card.locator('.scr-err')).toHaveText('The work sandbox is missing what the screen needs. Ask the install owner to update gtmworks.');
 await expect(card.locator('.scr-st')).toHaveText('Asleep');
 expect(fake.settings.screenCalls.filter(call=>call.method==='display.start'&&call.params.profile===seoProfile)).toEqual([]);
 expect(rows(`select count(*)::int as n from public.company_log where agent_id='${seo}' and action='agent_screen_woken'`)[0].n).toBe(0);
});

test('a Viewer watches a Screen but cannot wake it, and the server refuses a Viewer\'s wake',async({page})=>{
 fake.settings.screens.set(adsProfile,{running:true});
 const {card}=await openScreen(page,'viewer@example.com');
 await expect(card.locator('.scr-st')).toHaveText('Awake');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyAds is working on its own, and your account is view-only.');
 await page.keyboard.press('Escape');
 fake.settings.screens.set(adsProfile,{running:false});
 await page.reload();
 await expect(card.locator('.scr-st')).toHaveText('Asleep');
 await expect(card.getByRole('button')).toHaveCount(0);
 await expect(card.locator('.scr-ov__pill')).toHaveCount(0);
 const wake=await page.request.post('/api/agent-screen',{data:{company,agent:ads}});
 expect(wake.status()).toBe(403);
 expect(fake.settings.screens.get(adsProfile)?.running).toBe(false);
});

test('the server answers the Screen per Role, and finds nothing of an Agent hidden from the caller',async({page})=>{
 // A Manager the Agent is hidden from: no state, no wake and no picture.
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 for(const answer of [await page.request.get(`/api/agent-screen?company=${company}&agent=${ads}`),await page.request.post('/api/agent-screen',{data:{company,agent:ads}}),
  await page.request.get(`/api/agent-screen/picture?company=${company}&agent=${ads}`)]) {
  expect(answer.status()).toBe(404);
  expect(await answer.json()).toEqual({error:'agentScreenNotFound'});
 }
 expect(fake.settings.screens.get(adsProfile)?.running).toBe(false);
 // A Contributor who sees it wakes it; one already awake is woken again with nothing more logged.
 await page.context().clearCookies();
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 const before=rows(`select count(*)::int as n from public.company_log where agent_id='${ads}' and action='agent_screen_woken'`)[0].n;
 const woken=await page.request.post('/api/agent-screen',{data:{company,agent:ads}});
 expect([woken.status(),await woken.json()]).toEqual([200,{screen:'awake'}]);
 const again=await page.request.post('/api/agent-screen',{data:{company,agent:ads}});
 expect([again.status(),await again.json()]).toEqual([200,{screen:'awake'}]);
 expect(rows(`select count(*)::int as n from public.company_log where agent_id='${ads}' and action='agent_screen_woken'`)[0].n).toBe(Number(before)+1);
 // A person controls it: the state says so, and there is no picture.
 fake.settings.screens.set(adsProfile,{running:true,holder:'human'});
 expect(await (await page.request.get(`/api/agent-screen?company=${company}&agent=${ads}`)).json()).toEqual({screen:{state:'awake',control:'person',refusal:null}});
 const withheld=await page.request.get(`/api/agent-screen/picture?company=${company}&agent=${ads}`);
 expect([withheld.status(),await withheld.json()]).toEqual([409,{picture:'withheld'}]);
});
