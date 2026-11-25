import { test, expect } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { signIn, chooseCompany } from './sign-in';
import { appOrigin, inbox, mail } from './lane.mjs';
import { execFileSync } from 'node:child_process';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Every page here is read in both languages at 1440, and the List and the Agents page also at 390. At 390 the visual
// lane checks the Arabic faces on its screens; the English ones are read by the next case (#257).
test('Paperclip Inter and Arabic-only Vazirmatn load locally',async({page,context})=>{
 // Twenty whole pages, each read in two languages, is the longest sweep in the suite; the browser shard runs four lanes
 // on four cores, where it once passed the minute before the last page (and finished in 42 s on its retry). The budget
 // is the time this test may take; every face, page and width is still read as below.
 test.setTimeout(120000);
 const fontRequests:string[]=[];
 const externalFonts:string[]=[];
 context.on('request',request=>{
  const url=new URL(request.url());
  if(request.resourceType()==='font'||/\.(?:otf|ttf|woff2?|eot)(?:$|\?)/i.test(url.pathname)) fontRequests.push(request.url());
  if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) externalFonts.push(request.url());
 });
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 for(const language of ['en','ar']) {
  await chooseLanguageInSettings(page,language);
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  for(const [path,width] of [...['home','work/board','work/board/1','work/calendar','work/list','approvals','agents','settings'].map(path=>[path,1440] as const),['work/list',390] as const,['agents',390] as const]) {
   await page.setViewportSize({width,height:900});
   await page.goto(`/c/rs-learning/${path}`);
   await page.evaluate(()=>document.fonts.ready);
   const family=await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''));
   expect(family).toMatch(language==='en'?/^InterVariable$/:/^(?:__)?Vazirmatn(?:_|$)/);
   // Every face that draws text on the page has loaded. The board views (ADR 0013) draw every word in the approved
   // reference's IBM Plex Sans Arabic, so the body face draws nothing there and is rightly never fetched; every other page
   // draws its own text in the body face.
   const drawn=await page.evaluate(()=>[...new Set([...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&[...el.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent!.trim())).map(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,'')))]);
   const plex=drawn.find(font=>/^(?:__)?IBM[_ ]Plex[_ ]Sans[_ ]Arabic(?:_|$)/.test(font));
   expect(plex,'the shell draws in IBM Plex Sans Arabic').toBeTruthy();
   expect(drawn.filter(font=>font!==family&&font!==plex),'no other face draws text').toEqual([]);
   if(!['work/board','work/board/1','work/calendar','work/list','approvals'].includes(path)) expect(drawn).toContain(family);
   for(const font of drawn) expect(await page.evaluate(font=>Array.from(document.fonts).some(face=>face.family.replaceAll(/["']/g,'')===font&&face.status==='loaded'),font),`${font} loaded`).toBe(true);
   for(const el of await page.locator(':is(.content h1,.content h2,.content h3,.modal h2):not(.board-view *, .cw *)').all()) expect(await el.evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''))).toBe(family);
   // The shell and the board (ADR 0013) take the approved reference's face (IBM Plex Sans Arabic) in both languages.
   if(width===1440) for(const heading of await page.locator('.sidebar .sb-label, .board-view h1, .board-view h2').all()) expect(await heading.evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''))).toMatch(/^(?:__)?IBM[_ ]Plex[_ ]Sans[_ ]Arabic(?:_|$)/);
   if(path==='home') for(const metric of await page.locator('.stats .stat').all()) {
    const geometry=await metric.evaluate(node=>{
     const value=node.querySelector('strong')!,icon=node.querySelector('svg')!;
     const range=document.createRange();range.selectNodeContents(value);
     const text=range.getBoundingClientRect(),graphic=icon.getBoundingClientRect();
     return {gap:getComputedStyle(node).direction==='rtl'?text.left-graphic.right:graphic.left-text.right};
    });
    expect(geometry.gap,'work figure must not overlap its icon').toBeGreaterThanOrEqual(0);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
 }
 await chooseLanguageInSettings(page,'en');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 expect(fontRequests.length).toBeGreaterThan(0);
 for(const request of fontRequests) {
  const url=new URL(request);
  expect(url.origin).toBe(appOrigin);
  expect(url.pathname).toMatch(/^\/_next\/static\/media\/[^/]+$/);
 }
 expect(externalFonts).toEqual([]);
});

// The visual lane draws Arabic only (#257): each page in English at 390 keeps Inter, has loaded every face it draws text
// in, and does not scroll sideways.
test('every page in English at 390 draws in faces that loaded, Inter for its own text',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await chooseLanguageInSettings(page,'en');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 for(const path of ['home','work/board','work/board/1','work/calendar','work/list','approvals','agents','settings']) {
  await page.goto(`/c/rs-learning/${path}`);
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,'')),path).toBe('InterVariable');
  const unloaded=await page.evaluate(()=>[...new Set([...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&[...el.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent!.trim())).map(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,'')))].filter(font=>!Array.from(document.fonts).some(face=>face.family.replaceAll(/["']/g,'')===font&&face.status==='loaded')));
  expect(unloaded,`${path}: every face that draws text has loaded`).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth),path).toBe(390);
 }
});

test('sign-in returns to requested page, company switch preserves section, and access is isolated',async({page})=>{
 await signIn(page,'multi@example.com','/c/rs-learning/approvals'); await expect(page).toHaveURL(/\/c\/rs-learning\/approvals/); await chooseCompany(page,'aleem'); await expect(page).toHaveURL(/\/c\/aleem\/approvals/); const response=await page.goto('/c/rs-consultations/home'); expect(response?.status()).toBe(404); const unknown=await page.goto('/c/unknown/home'); expect(unknown?.status()).toBe(404);
});
test('an expired session is refreshed and the rotated cookies survive another request', async ({ page, context }) => {
 await signIn(page, 'manager@example.com', '/c/rs-learning/home');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home/);
 const readCookies = async () => (await context.cookies()).filter(cookie => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a,b) => a.name.localeCompare(b.name, 'en', {numeric:true}));
 const cookies = await readCookies();
 expect(cookies.length).toBeGreaterThan(0);
 const encoded = cookies.map(cookie => cookie.value).join('');
 expect(encoded.startsWith('base64-')).toBe(true);
 const session = JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString('utf8'));
 const oldRefreshToken = session.refresh_token;
 session.expires_at = 1;
 const expired = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
 const baseName = cookies[0].name.replace(/\.\d+$/, '');
 for (const cookie of cookies) await context.clearCookies({name:cookie.name});
 const chunks = expired.match(/.{1,3000}/g) || [];
 await context.addCookies(chunks.map((value, index) => ({name: chunks.length === 1 ? baseName : `${baseName}.${index}`, value, url:appOrigin})));
 await page.goto('/c/rs-learning/approvals');
 await expect(page).toHaveURL(/\/c\/rs-learning\/approvals/);
 const refreshed = (await readCookies()).map(cookie => cookie.value).join('');
 const newSession = JSON.parse(Buffer.from(refreshed.slice(7), 'base64url').toString('utf8'));
 expect(newSession.refresh_token).not.toBe(oldRefreshToken);
 await page.goto('/c/rs-learning/home');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home/);
});

test('members controls, the Role list, viewer access, and no all-companies list',async({page,context})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings/members');
 await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible();
 const owner=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^عمر$/})}); await owner.getByRole('button',{name:"Remove"}).click(); await expect(page.getByRole('status').filter({hasText:'The last owner'})).toContainText('The last owner');
 const viewer=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); const roles=await viewer.getByRole('combobox',{name:"Member role",exact:true}).locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)); expect(roles).toEqual(['owner','manager','contributor','viewer']); await expect(viewer.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0); await viewer.getByRole('combobox',{name:"Member role",exact:true}).selectOption('contributor'); await viewer.getByLabel("Publishing").check(); await viewer.getByRole('button',{name:"Save"}).click(); await expect(page.getByRole('status').filter({hasText:'Change saved.'})).toContainText('Change saved.'); const changed=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); await expect(changed.getByRole('combobox',{name:"Member role",exact:true})).toHaveValue('contributor'); await expect(changed.getByRole('combobox',{name:"Agent role",exact:true})).toBeVisible(); await changed.getByRole('combobox',{name:"Member role",exact:true}).selectOption('viewer'); await changed.getByLabel("Publishing").uncheck(); await changed.getByRole('button',{name:"Save"}).click(); await expect(changed.getByRole('combobox',{name:"Member role",exact:true})).toHaveValue('viewer'); await expect(changed.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0);
 expect((await page.goto('/all-brands'))?.status()).toBe(404);
 await context.clearCookies(); await signIn(page,'viewer@example.com','/c/rs-learning/settings/members'); await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible(); await expect(page.getByRole('button',{name:"Remove"})).toHaveCount(0); await expect(page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})})).toContainText("Viewer"); const res=await page.goto('/all-brands'); expect(res?.status()).toBe(404);
});

test('invite link signs the new member into the company',async({page,context})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings/members');
 await page.request.delete(inbox);
 await page.getByLabel("Email").fill('invited@example.com'); await page.getByRole('button',{name:"Send invitation"}).click(); await expect(page.getByRole('status').filter({hasText:'Invite sent to'})).toContainText('Invite sent to');
 let link=''; for(let i=0;i<30&&!link;i++){const mailbox=await (await page.request.get(inbox)).json(); const item=mailbox.messages?.find((m:{To:{Address:string}[]})=>m.To.some(t=>t.Address==='invited@example.com')); if(item){const message=await (await page.request.get(`${mail}/api/v1/message/${item.ID}`)).json(); link=(message.HTML||message.Text).match(/https?:\/\/[^"\s<>]+/g)?.find((url:string)=>url.includes('/verify'))?.replaceAll('&amp;','&')||'';} if(!link) await page.waitForTimeout(1000);}
 expect(link).toBeTruthy(); await context.clearCookies(); await page.goto(link);
 // A new Member chooses a password before the Company opens (#41).
 await page.getByLabel('New password').fill('invited-password'); await page.getByLabel('Confirm password').fill('invited-password'); await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\/members/); await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible();
});

test('the Owner of every company lands on a Company home from the sign-in page and opens each one with no extra verification step',async({page})=>{
 // Signing in from the sign-in page itself, with no page asked for, lands a person of several companies on a Company home.
 await signIn(page,'omar@example.com','/sign-in'); await expect(page).toHaveURL(/\/c\/[^/]+\/home$/);
 await page.goto('/c/rs-learning/home'); await expect(page.locator('.home-dashboard')).toBeVisible();
 for(const slug of ['rs-consultations','aleem']) { await chooseCompany(page,slug); await expect(page).toHaveURL(new RegExp(`/c/${slug}/home$`)); await expect(page.locator('.home-dashboard')).toBeVisible(); }
});

test('a design file over 1MB with an Arabic name is added to a Card and uploaded again as its next version',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/1');
 const file={name:'تصميم.png',mimeType:'image/png',buffer:Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64'), Buffer.alloc(1024*1024)])};
 // The Card window's Result (#678): each upload is the next Version of the Card's design.
 const versions=page.getByRole('dialog').getByRole('list',{name:'Versions'});
 await page.getByLabel('Upload a version').setInputFiles(file);
 await expect(versions.getByRole('link',{name:'Open version 1: تصميم.png'})).toBeVisible();
 await page.getByLabel('Upload a version').setInputFiles(file);
 await expect(versions.getByRole('link',{name:'Open version 2: تصميم.png'})).toBeVisible();
});

test('a review: an Owner approves it into Planned with its date ahead and into Done with none, and sends one back with a reason the team reads',async({page,browser})=>{
 // #681: one review, decided by any Owner or Manager who sees the Card, the first answer closing it; approval steps are gone.
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const card=page.getByRole('dialog');
 const waiting=page.locator('.col[data-column="waiting"]');
 const make=async(name:string)=>{
  await page.goto('/c/rs-learning/work/board');
  await page.getByRole('button',{name:"+ New card"}).click();
  await page.getByLabel('Message',{exact:true}).fill(name);
  await page.getByRole('button',{name:"Create card"}).click();
  await expect(page).toHaveURL(/\/work\/board\/\d+$/);
  return Number(page.url().split('/').pop());
 };
 const sendForReview=async()=>{
  await card.getByRole('button',{name:/^Status:/}).click();
  await card.getByRole('menuitemradio',{name:'Send for review'}).click();
  await expect(card.getByRole('button',{name:/^Status: Waiting on you/})).toBeVisible();
 };
 const title=`بطاقة موافقة ${Date.now()}`;
 const cardId=await make(title);
 // The Card's old fields are read in the place of its description until #684 moves them into it (#678).
 query(`update public.work_cards set caption='نص مخصص للمراجعة',offering='عرض مخصص للمراجعة',go_live=now()+interval '10 days' where id=${cardId}`);
 await page.reload();
 await sendForReview();
 // "Waiting on you" (ADR 0013) holds the Card for every Owner and Manager who sees it; the sidebar counts it.
 await page.goto('/c/rs-learning/approvals');
 const queued=waiting.locator('.approval-card').filter({hasText:title});
 await expect(queued).toBeVisible();
 const count=await waiting.locator('.approval-card').count();
 await expect(page.locator('.sidebar .sb-count[href$="/approvals"]')).toHaveText(String(count));
 // The decision is made inside the Card, beside the brief it is about.
 await queued.getByRole('link',{name:title}).click();
 await expect(card.locator('[data-slot="description"]')).toContainText('نص مخصص للمراجعة');
 const review=card.locator('[data-card-section="review"]');
 await review.getByRole('button',{name:"Approve"}).click();
 // Its publishing date is ahead: Planned, with the approved symbol; the review is closed for everyone.
 await expect(card.getByRole('button',{name:'Status: Planned · Approved'})).toBeVisible();
 expect(JSON.parse(query(`select decision from public.work_reviews where card_id=${cardId}`))).toEqual([{decision:'approved'}]);
 await page.goto('/c/rs-learning/approvals');
 await expect(waiting.locator('.kcard').filter({hasText:title})).toHaveCount(0);

 // A Card with no publishing date, approved by the Manager, is Done.
 const undated=`بطاقة بلا تاريخ ${Date.now()}`;
 const undatedId=await make(undated);
 await sendForReview();
 const manager=await (await browser.newContext()).newPage();
 await signIn(manager,'manager@example.com',`/c/rs-learning/work/board?card=${undatedId}`);
 await manager.getByRole('dialog').locator('[data-card-section="review"]').getByRole('button',{name:"Approve"}).click();
 await expect(manager.getByRole('dialog').getByRole('button',{name:/^Status: Done/})).toBeVisible();

 // Sent back with a reason: In progress, and the reason is a comment the team reads.
 const rejected=`بطاقة رفض ${Date.now()}`;
 const rejectedId=await make(rejected);
 await sendForReview();
 await page.goto(`/c/rs-learning/work/board?card=${rejectedId}`);
 const decision=card.locator('[data-card-section="review"]');
 await decision.getByRole('button',{name:"Send back"}).click();
 // The reason is required.
 await decision.getByRole('button',{name:"Send back"}).click();
 await expect(decision.getByText('Write the reason so whoever works on the card knows what to change.')).toBeVisible();
 await decision.getByLabel('The reason').fill('يرجى تعديل التصميم');
 await decision.getByRole('button',{name:"Send back"}).click();
 await expect(card.getByRole('button',{name:/^Status: In progress/})).toBeVisible();
 await expect(card.locator('[data-card-section="sent-back"]')).toContainText('يرجى تعديل التصميم');
 await expect(card.locator('.cw-feed')).toContainText('يرجى تعديل التصميم');
 await page.goto('/c/rs-learning/approvals');
 await expect(waiting.locator('.approval-card').filter({hasText:rejected})).toHaveCount(0);
});

// The external-agent API is gone (#341): its routes answer not found, with or without a key.
test('the old agent API routes answer not found', async ({request}) => {
 const key={Authorization:'Bearer agt_local_fixture_for_tests_only'};
 const root='/api/v1/companies/rs-learning';
 for(const [method,path] of [['GET',`${root}/cards?next_actor=me`],['POST',`${root}/cards`],['PATCH',`${root}/cards/1`],['POST',`${root}/cards/1/comment`],
  ['POST',`${root}/cards/1/run-keys`],['DELETE',`${root}/cards/1/run-keys`],['GET',`${root}/skills`],['GET',`${root}/cards/1/files/1`]] as const)
  for(const headers of [key,{}]) expect((await request.fetch(path,{method,headers,data:method==='GET'||method==='DELETE'?undefined:{}})).status(),`${method} ${path}`).toBe(404);
});

// The publishing date's round trip in the Card window (#678): another property saved leaves the date as it was, and a
// changed date is read back as its activity on the Card and on Home.
test('an unrelated save keeps a Card\'s publishing date, and a changed date reads back on the Card and Home',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/2');
 const card=page.getByRole('dialog');
 await card.getByRole('tab',{name:/^Activity \d+$/}).click();
 const dates=card.locator('#cw-list .lg-row').filter({hasText:'publishing date'});
 const before=await dates.count();
 const title=(await card.getByRole('heading',{level:2}).textContent())!.trim();
 await card.getByRole('button',{name:title}).click();
 await card.getByRole('textbox',{name:'Card title'}).fill(`${title} (renamed)`);
 await page.keyboard.press('Enter');
 await expect(card.locator('#cw-list')).toContainText(`${title} (renamed)`);
 await expect(dates).toHaveCount(before);
 await card.getByLabel('Publishing date',{exact:true}).fill('2032-11-12');
 await expect(dates).toHaveCount(before+1);
 expect(JSON.parse(query(`select to_char(go_live at time zone 'UTC','YYYY-MM-DD') as day from public.work_cards where id=2`))).toEqual([{day:'2032-11-12'}]);
 await page.goto('/c/rs-learning/home');
 await expect(page.locator('.detail-row').filter({has:page.locator('a[href="/c/rs-learning/work/board/2"]')}).getByText(/Updated publishing date: November 12/)).toBeVisible();
});

test('an error thrown in the page is reported to the server log endpoint',async({page})=>{
 await page.goto('/sign-in');
 const reported=page.waitForRequest(request=>request.url().endsWith('/api/client-errors')&&request.method()==='POST');
 const answered=page.waitForResponse(response=>response.url().endsWith('/api/client-errors'));
 await page.evaluate(()=>{ setTimeout(()=>{ throw new Error('forced page error'); }); });
 const body=(await reported).postDataJSON();
 expect(body).toMatchObject({source:'page',message:'forced page error',path:'/sign-in'});
 expect(body.stack).toContain('forced page error');
 expect((await answered).status()).toBe(204);
});

test('an error thrown right after load on a slow CPU is still reported to the server log endpoint',async({page})=>{
 const session=await page.context().newCDPSession(page);
 await session.send('Emulation.setCPUThrottlingRate',{rate:8});
 await page.goto('/sign-in');
 const reported=page.waitForRequest(request=>request.url().endsWith('/api/client-errors')&&request.method()==='POST');
 await page.evaluate(()=>{ setTimeout(()=>{ throw new Error('forced slow page error'); }); });
 const body=(await reported).postDataJSON();
 expect(body).toMatchObject({source:'page',message:'forced slow page error',path:'/sign-in'});
});
