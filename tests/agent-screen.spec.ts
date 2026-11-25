import { test, expect, freshSeed, type Page } from './fresh-seed';
import WebSocket from 'ws';
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
 freshSeed(testInfo);
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

 // The card's picture refreshes without a reload: a later grab replaces the first.
 const first=await shown(page,'.scr-card');
 await expect.poll(async()=>(await shown(page,'.scr-card')).grab,{timeout:5000}).not.toBe(first.grab);
 expect(first.src).toMatch(/^blob:/);
 // Watch opens the large view with the keyboard on its first action (here Take control, #713), and the live stream
 // replaces the refreshing picture there.
 const watch=card.getByRole('button',{name:'Watch',exact:true});
 await watch.click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view).toBeVisible();
 await expect(view.getByRole('button',{name:'Take control'})).toBeFocused();
 await expect(view.locator('.vw-chip')).toHaveText('Watching');
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyYour mouse and keyboard are locked, and Ads is working on its own.');
 await expect(view.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
 await expect(view.locator('img.scr__shot')).toHaveCount(0);

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
 await expect(view.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
 // The Engine put it to sleep: the next picture says so, and the view shows the asleep block with the real idle time.
 fake.settings.screens.set(adsProfile,{running:false});
 await expect(view.locator('.vw-off p')).toHaveText('The screen goes to sleep after 30 idle minutes, and wakes up on its own when Ads has work.');
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyNothing is running on the screen right now.');
 await view.getByRole('button',{name:'Wake it',exact:true}).click();
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyThe screen is waking up and opening the browser.');
 await expect(view.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
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

// #713: Take control for one session, then Done. The view's live stream comes through gtmworks's own /api/display/ws;
// a person in control works the Screen with their own mouse and keyboard, and every way the view ends gives it back.
// `stream` opens that socket as the signed-in person of a page, as the browser does, for what a page cannot do itself:
// lose its connection without a word, or send what the page never offers.
async function stream(page:Page,{agent=ads,origin}:{agent?:string,origin?:string}={}) {
 const app=new URL(page.url()).origin;
 const cookie=(await page.context().cookies(app)).map(({name,value})=>`${name}=${value}`).join('; ');
 const socket=new WebSocket(`${app.replace('http','ws')}/api/display/ws?company=${company}&agent=${agent}`,{headers:{cookie,...(origin?{origin}:{})}});
 const said:Record<string,unknown>[]=[];
 socket.on('message',(data,binary)=>{ if(!binary) said.push(JSON.parse(String(data))); });
 const closed=new Promise<number>(resolve=>socket.on('close',code=>resolve(code)));
 const refused=new Promise<number>(resolve=>socket.on('unexpected-response',(_request,response)=>resolve(response.statusCode??0)));
 socket.on('error',()=>{});
 return {socket,said,closed,refused,heard:(match:Record<string,unknown>)=>expect.poll(()=>said.some(message=>Object.entries(match).every(([key,value])=>message[key]===value)),{timeout:10000}).toBe(true)};
}
const released=()=>fake.settings.screenCalls.filter(call=>call.method==='display.lease.release'&&call.params.profile===adsProfile).length;
const controlRows=(action:string)=>rows(`select actor_id from public.company_log where agent_id='${ads}' and action='${action}' order by created_at,source_id`).map(row=>row.actor_id);
const owner='20000000-0000-0000-0000-000000000001';

test('a Member takes control of the Screen for this session, works it with their own mouse and keyboard, and every way out gives it back',async({page})=>{
 fake.settings.screens.set(adsProfile,{running:true}); fake.settings.screens.set(seoProfile,{});
 const {card}=await openScreen(page,'omar@example.com');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
 const take=view.getByRole('button',{name:'Take control'});
 await expect(take).toBeFocused();
 await expect(view.locator('.vw-take__d')).toHaveText('Needs your permission · this session only');

 // Take control asks first, with the keyboard on "Allow for this session"; Cancel goes back to watching.
 await take.click();
 await expect(view.locator('.vw-mode')).toHaveText('Take control from Ads?It holds still while you use the mouse and keyboard. This permission is for this session only: when you close the screen, control goes back to it, and next time it’ll ask you again.');
 const allow=view.getByRole('button',{name:'Allow for this session'});
 await expect(allow).toBeFocused();
 await view.getByRole('button',{name:'Cancel'}).click();
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyYour mouse and keyboard are locked, and Ads is working on its own.');
 await expect(take).toBeFocused();
 expect(fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire')).toEqual([]);
 // Nothing typed while watching reaches the Screen.
 await view.locator('.scr__live canvas').click({position:{x:20,y:20}});
 await page.keyboard.press('a');
 expect(fake.settings.screenInputs).toEqual([]);

 await take.click();
 await allow.click();
 await expect(view.locator('.vw-chip--ctrl')).toHaveText('You have control');
 await expect(view.locator('.vw-mode')).toHaveText('You have controlAds is holding still until you’re done. What you do on the screen is done in your name.');
 await expect(page.locator('.toast')).toContainText('You have control for this session only');
 await expect(view.locator('.scr.is-control')).toBeVisible();
 const done=view.getByRole('button',{name:'Done',exact:true});
 await expect(done).toBeFocused();
 await expect(card.locator('.scr-ov__line')).toHaveText('You have control · Ads is holding still');
 expect(fake.settings.screens.get(adsProfile)?.holder).toBe('human');
 // The person's own mouse and keyboard reach the Screen.
 await view.locator('.scr__live canvas').click({position:{x:30,y:30}});
 await page.keyboard.press('b');
 await expect.poll(()=>fake.settings.screenInputs.map(input=>input.kind)).toEqual(expect.arrayContaining(['pointer','key']));
 expect(fake.settings.screenInputs.every(input=>input.profile===adsProfile)).toBe(true);
 expect(controlRows('agent_screen_taken')).toEqual([owner]);

 // Done gives it back: Watching only, the reference's toast, and the Engine's lease back with the Agent.
 await done.click();
 await expect(page.locator('.toast')).toContainText('Gave control back to Ads, and it carried on from where it was');
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyYour mouse and keyboard are locked, and Ads is working on its own.');
 await expect(view.locator('.vw-chip')).toHaveText('Watching');
 await expect(take).toBeFocused();
 expect(fake.settings.screens.get(adsProfile)?.holder).toBe('agent');
 expect(released()).toBe(1);
 expect(controlRows('agent_screen_given_back')).toEqual([owner]);

 // Closing the view in control gives it back, with the reference's toast.
 await take.click(); await allow.click();
 await expect(done).toBeVisible();
 await view.getByRole('button',{name:'Close the screen'}).click();
 await expect(view).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Control went back to Ads when you closed the screen');
 await expect.poll(()=>fake.settings.screens.get(adsProfile)?.holder).toBe('agent');
 await expect.poll(released).toBe(2);

 // Leaving the page in control gives it back.
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 await view.getByRole('button',{name:'Take control'}).click(); await allow.click();
 await expect(done).toBeVisible();
 await page.goto('/c/rs-learning/home');
 await expect.poll(()=>fake.settings.screens.get(adsProfile)?.holder).toBe('agent');
 await expect.poll(released).toBe(3);

 // Losing the connection gives it back: a socket that ends with no closing word.
 const lost=await stream(page);
 await lost.heard({control:'agent'});
 lost.socket.send(JSON.stringify({take:true}));
 await lost.heard({control:'mine'});
 expect(fake.settings.screens.get(adsProfile)?.holder).toBe('human');
 lost.socket.terminate();
 await expect.poll(()=>fake.settings.screens.get(adsProfile)?.holder).toBe('agent');
 await expect.poll(released).toBe(4);
 await expect.poll(()=>controlRows('agent_screen_given_back').length).toBe(4);
 expect(controlRows('agent_screen_taken')).toEqual([owner,owner,owner,owner]);
 // Nothing of it went to the Engine from the browser, and the stream is gtmworks's own.
 await expect.poll(()=>fake.settings.screenStreams).toBe(0);
});

test('a page that loses its connection while in control says control went back, as closing the screen does',async({page})=>{
 fake.settings.screens.set(adsProfile,{running:true}); fake.settings.screens.set(seoProfile,{});
 // The page's own socket passes through as it is, until the connection is cut on the page's side, as a network that
 // drops. The server gives control back when its heartbeat finds the dead socket, which the case above shows with a
 // socket that ends without a closing word; here it is what the page says.
 const sockets:{close:(options?:{code?:number,reason?:string})=>Promise<void>}[]=[];
 await page.routeWebSocket(/\/api\/display\/ws/,socket=>{ socket.connectToServer(); sockets.push(socket); });
 const {card}=await openScreen(page,'omar@example.com');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await view.getByRole('button',{name:'Take control'}).click();
 await view.getByRole('button',{name:'Allow for this session'}).click();
 await expect(view.getByRole('button',{name:'Done',exact:true})).toBeVisible();
 await expect.poll(()=>fake.settings.screens.get(adsProfile)?.holder).toBe('human');
 await sockets.at(-1)?.close({code:1011,reason:'lost'});
 await expect(page.locator('.toast')).toContainText('Control went back to Ads when you closed the screen');
 await expect(view.getByRole('button',{name:'Take control'})).toBeVisible();
});

test('while one person holds the Screen, another sees Watching only with who has control and no picture of what is typed',async({page,browser})=>{
 fake.settings.screens.set(adsProfile,{running:true});
 const {card}=await openScreen(page,'omar@example.com');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await view.getByRole('button',{name:'Take control'}).click();
 await view.getByRole('button',{name:'Allow for this session'}).click();
 await expect(view.getByRole('button',{name:'Done',exact:true})).toBeVisible();

 const second=await browser.newContext({baseURL:new URL(page.url()).origin});
 try {
  const other=await second.newPage();
  const {card:otherCard}=await openScreen(other,'reviewer@example.com');
  await otherCard.getByRole('button',{name:'Watch',exact:true}).click();
  const otherView=other.getByRole('dialog',{name:'Ads’s screen'});
  await expect(otherView.locator('.vw-mode')).toHaveText('Watching onlyعمر has control of the screen now, so you can only watch.');
  await expect(otherView.getByRole('button',{name:'Take control'})).toHaveCount(0);
  await expect(otherView.locator('.scr__off')).toHaveText('Someone has control of the screen, so its picture is hidden.');
  await expect(otherView.locator('.scr__live:not(.is-waiting)')).toHaveCount(0);
  await expect(otherView.locator('.scr__live canvas')).toHaveCount(0);
  await expect(otherView.locator('img.scr__shot')).toHaveCount(0);
  // Only the person in control is streamed the Screen.
  await expect.poll(()=>fake.settings.screenStreams).toBe(1);
  // A take while another holds is refused, and never reaches the Engine.
  const acquired=fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire').length;
  const asked=await stream(other);
  await asked.heard({control:'other'});
  asked.socket.send(JSON.stringify({take:true}));
  await asked.heard({refused:'held'});
  asked.socket.close();
  expect(fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire').length).toBe(acquired);

  // Once it is given back the second person watches it live again, and may take it.
  await view.getByRole('button',{name:'Done',exact:true}).click();
  await expect(otherView.locator('.vw-mode')).toHaveText('Watching onlyYour mouse and keyboard are locked, and Ads is working on its own.');
  await expect(otherView.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
  await expect(otherView.getByRole('button',{name:'Take control'})).toBeVisible();
  expect(controlRows('agent_screen_taken').at(-1)).toBe(owner);
 } finally { await second.close(); }
});

test('the server takes control only for a Member who is not a Viewer and sees the Agent, and opens the stream only for one it is shown to',async({page})=>{
 fake.settings.screens.set(adsProfile,{running:true});
 const acquires=()=>fake.settings.screenCalls.filter(call=>call.method==='display.lease.acquire').length;
 const before=acquires();
 // A Viewer watches live, has no Take control, and the server refuses their take.
 const {card}=await openScreen(page,'viewer@example.com');
 await card.getByRole('button',{name:'Watch',exact:true}).click();
 const view=page.getByRole('dialog',{name:'Ads’s screen'});
 await expect(view.locator('.vw-mode')).toHaveText('Watching onlyAds is working on its own, and your account is view-only.');
 await expect(view.getByRole('button',{name:'Take control'})).toHaveCount(0);
 await expect(view.locator('.scr__live:not(.is-waiting) canvas')).toBeVisible();
 const watching=await stream(page);
 await watching.heard({control:'agent'});
 watching.socket.send(JSON.stringify({take:true}));
 await watching.heard({refused:'notAllowed'});
 watching.socket.close();
 expect(acquires()).toBe(before);
 // A page on another site may not open it at all.
 expect(await (await stream(page,{origin:'https://elsewhere.example'})).refused).toBe(403);
 // A Manager the Agent is hidden from is not shown its Screen; with no session at all it is refused for signing in.
 await page.context().clearCookies();
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 expect(await (await stream(page)).closed).toBe(4404);
 await page.context().clearCookies();
 expect(await (await stream(page)).closed).toBe(4401);
 expect(acquires()).toBe(before);
 expect(fake.settings.screens.get(adsProfile)?.holder??'agent').toBe('agent');
});

// #714: a step the Agent stopped at on its own Screen, handed to its Conversation's person. Its card is shown as the
// worker shows a hand_over call with "on my screen" (agent_show_card; tests/agent-tools.test.mjs proves the call itself).
const omar='20000000-0000-0000-0000-000000000001';
const step={title:'Publish the December campaign',app:'Meta Ads'};
function handedOnScreen() {
 const conversation=randomUUID(); const run=`screen-hand-${conversation.slice(0,8)}`;
 query(`do $$ begin
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${ads}','Ads');
   insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
    values ('${company}','${conversation}','person','${omar}','عمر','Set up the December campaign',gen_random_uuid(),'${run}');
   -- The Run ended with its reply, as the worker keeps it, so no reader asks the Engine for it again.
   insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
    values ('${company}','${conversation}','agent','${ads}','Ads','The campaign is ready. I stopped at Publish for you.','${run}');
  end $$;`);
 let calls=0;
 const hand=(button?:string)=>{
  const call=`call-${calls++}`;
  query(`select public.agent_show_card('${conversation}','${run}','${call}','hand','${step.title}','${JSON.stringify({app:step.app,line:'The campaign is ready in Ads Manager.',rows:[],screen:true,...(button?{step:button}:{})})}'::jsonb)`);
  return Number(rows(`select id from public.reply_cards where conversation_id='${conversation}' and call_id='${call}'`)[0].id);
 };
 // Its steps left open are closed after, so no later test finds them waiting.
 return {conversation,hand,drop:()=>query(`update public.reply_cards set state='closed' where conversation_id='${conversation}' and state='open'`)};
}

test('an Agent hands its person a step on its Screen: the toast opens it, Open the screen puts the keyboard on Done it, and Done it in the view is the chat card\'s one record',async({page})=>{
 test.setTimeout(120000);
 fake.settings.screens.set(adsProfile,{running:true}); fake.settings.screens.set(seoProfile,{});
 const {conversation,hand,drop}=handedOnScreen();
 try {
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  await expect(page.locator('.sidebar')).toBeVisible();
  // The step arrives while its person has the product open: the toast names the Agent and the step, with Open.
  const card=hand();
  const toast=page.locator('.toast');
  await expect(toast).toContainText('Ads stopped at “Publish the December campaign” and handed it to you',{timeout:15000});
  await toast.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/c/rs-learning/conversations/${conversation}`));
  const chatCard=page.getByRole('group',{name:`Handed to you: ${step.title}`});
  await expect(chatCard).toBeFocused();
  await expect(chatCard.getByRole('button')).toHaveText(['Open the screen','Done it']);
  await expect(chatCard.locator('a')).toHaveCount(0);
  // The Agent's screen card waits on its person, with the step's line.
  const details=page.getByRole('complementary',{name:'Details: Ads',exact:true});
  const screenCard=details.locator('section.dp-sec').filter({has:page.getByRole('heading',{name:/^Agent’s screen/})});
  await expect(screenCard.locator('.scr-st')).toHaveText('Awake · waiting on you');
  await expect(screenCard.locator('.scr-st')).toHaveClass(/scr-st--wait/);
  await expect(screenCard.locator('.scr-ov__line')).toHaveText('Stopped at “Publish the December campaign” in Meta Ads · handed to you');
  // A second tab holds the same card open.
  const other=await page.context().newPage();
  await other.goto(`/c/rs-learning/conversations/${conversation}`);
  const otherCard=other.getByRole('group',{name:`Handed to you: ${step.title}`});
  await expect(otherCard.getByRole('button',{name:'Done it'})).toBeEnabled();

  // Open the screen: the view, its banner, and the keyboard on its Done it.
  await chatCard.getByRole('button',{name:'Open the screen'}).click();
  const view=page.getByRole('dialog',{name:'Ads’s screen'});
  const banner=view.getByRole('group',{name:step.title});
  await expect(banner.locator('.badge')).toHaveText('Handed to you');
  await expect(banner.locator('.vw-hand__t > span')).toHaveText('Ads stopped at “Publish the December campaign” and didn’t press it. Press it yourself in Meta Ads or take control, then “Done it”.');
  await expect(banner.getByRole('button',{name:'Done it'})).toBeFocused();
  await expect(view).not.toContainText('never presses');

  // Done it in the view: the banner goes, the card reads Awake, the keyboard is on the close button, the chat card is done.
  await banner.getByRole('button',{name:'Done it'}).click();
  await expect(view.locator('.vw-hand')).toHaveCount(0);
  await expect(view.getByRole('button',{name:'Close the screen'})).toBeFocused();
  await expect(screenCard.locator('.scr-st')).toHaveText('Awake');
  await expect(chatCard.locator('.card__outcome')).toContainText('Done ·');
  const kept=()=>rows(`select state,done_by,done_at from public.reply_cards where id=${card}`);
  const [first]=kept();
  expect([first.state,first.done_by]).toEqual(['done',omar]);
  // The chat card pressed in the other tab answers that record: one record, one log row.
  await otherCard.getByRole('button',{name:'Done it'}).click();
  await expect(otherCard.locator('.card__outcome')).toContainText('Done ·');
  expect(kept()).toEqual([first]);
  expect(rows(`select count(*)::int as n from public.company_log where action='agent_hand_done' and source_id=${card}`)).toEqual([{n:1}]);
  await other.close();
  await view.getByRole('button',{name:'Close the screen'}).click();
  await expect(view).toHaveCount(0);
 } finally { drop(); }
});

test('a step handed on the Screen is its person\'s alone: another Member and a Viewer see the Screen as usual',async({page})=>{
 fake.settings.screens.set(adsProfile,{running:true}); fake.settings.screens.set(seoProfile,{});
 const {hand,drop}=handedOnScreen();
 try {
  hand();
  // Its person reads it on the sidebar's poll, and nobody else does.
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const handed=async()=>(await (await page.request.get(`/api/sidebar?company=${company}`)).json()).handed;
  expect((await handed()).map((row:{title:string})=>row.title)).toEqual([step.title]);
  for(const email of ['reviewer@example.com','viewer@example.com']) {
   await page.context().clearCookies();
   const {card}=await openScreen(page,email);
   expect(await handed(),email).toEqual([]);
   await expect(card.locator('.scr-st'),email).toHaveText('Awake');
   const watch=card.getByRole('button',{name:'Watch',exact:true});
   await watch.hover();
   await expect(card.locator('.scr-ov__line'),email).toHaveCount(0);
   await watch.click();
   const view=page.getByRole('dialog',{name:'Ads’s screen'});
   await expect(view.locator('.vw__foot')).toBeVisible();
   await expect(view.locator('.vw-hand'),email).toHaveCount(0);
   await expect(page.locator('.toast'),email).toHaveCount(0);
   await view.getByRole('button',{name:'Close the screen'}).click();
  }
 } finally { drop(); }
});
