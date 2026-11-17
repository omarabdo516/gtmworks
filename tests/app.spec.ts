import { test, expect } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { createHmac } from 'node:crypto';
import { signIn, chooseCompany } from './sign-in';
import { appOrigin, inbox, mail } from './lane.mjs';
// Every other page here is drawn in both languages at both widths by the journeys; the List and the Agents page are
// drawn by none, so they are also read at 390.
test('Paperclip Inter and Arabic-only Vazirmatn load locally',async({page,context})=>{
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
   if(!['work/board','work/calendar','work/list','approvals'].includes(path)) expect(drawn).toContain(family);
   for(const font of drawn) expect(await page.evaluate(font=>Array.from(document.fonts).some(face=>face.family.replaceAll(/["']/g,'')===font&&face.status==='loaded'),font),`${font} loaded`).toBe(true);
   for(const el of await page.locator(':is(.content h1,.content h2,.content h3,.modal h2):not(.board-view *)').all()) expect(await el.evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''))).toBe(family);
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
 await page.getByLabel("Email").fill('invited@example.com'); await page.getByRole('button',{name:"Send invitation"}).click(); await expect(page.getByRole('status').filter({hasText:'An invitation link was sent'})).toContainText('An invitation link was sent');
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
 await page.getByLabel('New design file').setInputFiles(file);
 await page.getByRole('button',{name:"Add design"}).click();
 await expect(page.getByText(/Version 1:/)).toBeVisible();
 await page.locator('input[type=file]').first().setInputFiles(file);
 await page.getByRole('button',{name:"Upload version"}).first().click();
 await expect(page.getByText(/Version 2:/)).toBeVisible();
});

test('approval queue, rejection and ordered steps',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings/work');
 const settings=page.locator('.approval-settings');
 await settings.getByLabel("New step name").fill('مراجعة إضافية للاختبار');
 await settings.getByLabel("New approver").selectOption('role:owner');
 await settings.getByRole('button',{name:"Add step"}).click();
 await expect(settings.locator('input[value="مراجعة إضافية للاختبار"]')).toBeVisible();
 await page.goto('/c/rs-learning/work/board');
 await page.getByRole('button',{name:"+ New card"}).click();
 const title=`بطاقة موافقة ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(title);
 await page.getByRole('button',{name:"Create card"}).click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/);
 const cardUrl=page.url();
 await page.getByLabel("Caption",{exact:true}).fill('نص مخصص للمراجعة');
 await page.getByLabel("Offering",{exact:true}).fill('عرض مخصص للمراجعة');
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), page.getByRole('button',{name:"Save changes"}).click()]);
 await page.getByLabel("Move to list").selectOption({label:'مراجعة'});
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 // "Waiting on you" (ADR 0013) holds the card; the sidebar counts the cards waiting for this approver.
 await page.goto('/c/rs-learning/approvals');
 const waiting=page.locator('.col[data-column="waiting"]');
 const queued=waiting.locator('.approval-card').filter({hasText:title});
 await expect(queued).toBeVisible();
 const count=await waiting.locator('.approval-card').count();
 await expect(page.locator('.sidebar .sb-count[href$="/approvals"]')).toHaveText(String(count));
 await expect(queued.getByRole('link',{name:title})).toHaveAttribute('href',new URL(cardUrl).pathname);
 // The decision is made inside the card, beside the caption and the brief it is about.
 await queued.getByRole('link',{name:title}).click();
 // By role: a filled textarea's text is part of its wrapping label's text, so getByLabel stops matching it once it has a caption.
 await expect(page.getByRole('textbox',{name:"Caption",exact:true})).toHaveValue('نص مخصص للمراجعة');
 await expect(page.getByLabel("Offering",{exact:true})).toHaveValue('عرض مخصص للمراجعة');
 const review=page.locator('[data-card-section="review"]');
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), review.getByRole('button',{name:"Approve"}).click()]);
 // The second step is also Omar's: the card is still waiting on him.
 await page.goto('/c/rs-learning/approvals');
 await expect(waiting.locator('.approval-card').filter({hasText:title})).toBeVisible();
 await waiting.locator('.approval-card').filter({hasText:title}).getByRole('link',{name:title}).click();
 await page.locator('[data-card-section="review"]').getByRole('button',{name:"Approve"}).click();
 await expect(page.locator('.card-stage-line')).toContainText('معتمد');
 await page.goto('/c/rs-learning/approvals');
 await expect(waiting.locator('.kcard').filter({hasText:title})).toHaveCount(0);
 await page.goto(cardUrl);
 await expect(page.locator('.card-stage-line')).toContainText('معتمد');
 await page.goto('/c/rs-learning/work/board');
 await page.getByRole('button',{name:"+ New card"}).click();
 const rejected=`بطاقة رفض ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(rejected);
 await page.getByRole('button',{name:"Create card"}).click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/);
 const rejectedUrl=page.url();
 await page.getByLabel("Move to list").selectOption({label:'مراجعة'});
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 await page.goto('/c/rs-learning/approvals');
 const row=waiting.locator('.approval-card').filter({hasText:rejected});
 await row.getByRole('link',{name:rejected}).click();
 const decision=page.locator('[data-card-section="review"]');
 await decision.getByText("Reject with a reason").click();
 await decision.getByLabel("Rejection reason").fill('يرجى تعديل التصميم');
 await decision.getByLabel("Design needs work",{exact:true}).check();
 await decision.getByRole('button',{name:"Confirm rejection"}).click();
 await expect(page.locator('.rejection-notice')).toContainText('يرجى تعديل التصميم');
 await page.goto('/c/rs-learning/approvals');
 await expect(row).toHaveCount(0);
 await page.goto(rejectedUrl);
 await expect(page.locator('.card-stage-line')).toContainText('تصميم ومونتاج');
 await expect(page.locator('.rejection-notice')).toContainText('يرجى تعديل التصميم');
 await page.goto('/c/rs-learning/settings/work');
 const step=page.locator('.approval-settings form').filter({has:page.locator('input[value="مراجعة إضافية للاختبار"]')});
 await step.getByRole('button',{name:"Delete"}).click();
 await expect(step).toHaveCount(0);
});

test('agent creates and submits a card; rejection produces a signed webhook', async ({page}) => {
 const {createServer}=await import('node:http');
 const received:{body:string,signature:string|undefined}[]=[];
 const receiver=createServer((req,res)=>{let body='';req.setEncoding('utf8');req.on('data',chunk=>body+=chunk);req.on('end',()=>{received.push({body,signature:req.headers['x-gtmworks-signature'] as string|undefined});res.writeHead(204).end();});});
 await new Promise<void>(resolve=>receiver.listen(0,'127.0.0.1',resolve));
 try {
  const address=receiver.address(); if(!address || typeof address==='string') throw new Error('receiver unavailable');
  await signIn(page,'omar@example.com','/c/rs-learning/settings/agents');
  await page.getByLabel("Notification URL").fill(`http://127.0.0.1:${address.port}/events`);
  await page.getByLabel("Signing secret").fill('fixture-webhook-secret');
  await page.getByRole('button',{name:"Save notifications"}).click();
  await expect(page.getByRole('status').filter({hasText:'Notification settings saved.'})).toContainText('Notification settings saved.');
  await page.goto('/c/rs-learning/work/board/1');
  const review=await page.getByLabel("Move to list").locator('option').filter({hasText:'مراجعة'}).getAttribute('value');
  expect(review).toBeTruthy();
  const ideaStage=await page.getByLabel("Move to list").locator('option').filter({hasText:'أفكار'}).getAttribute('value');
  expect(ideaStage).toBeTruthy();
  const headers={Authorization:'Bearer agt_local_fixture_for_tests_only'};
  const root='/api/v1/companies/rs-learning/cards';
  const initial=await page.request.get(`${root}?next_actor=me`,{headers}); expect(initial.status()).toBe(200);
  const listing=await initial.json(); expect(Array.isArray(listing.cards)).toBe(true);
  const title=`عمل الوكيل ${Date.now()}`;
  const created=await page.request.post(root,{headers:{...headers,'Idempotency-Key':`create-${Date.now()}`},data:{title,stage:Number(ideaStage),evidence:'https://example.test/evidence'}}); expect(created.status()).toBe(201);
  const {id}=await created.json();
  const invalid=await page.request.post(root,{headers:{...headers,'Idempotency-Key':`invalid-${id}`},data:{title,stage:'invalid'}}); expect(invalid.status()).toBe(400);
  const uploadKey=`upload-${id}`; const multipart={file:{name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('creative fixture')},evidence:'https://example.test/creative'};
  const uploaded=await page.request.post(`${root}/${id}/upload`,{headers:{...headers,'Idempotency-Key':uploadKey},multipart}); expect(uploaded.status()).toBe(201);
  const retried=await page.request.post(`${root}/${id}/upload`,{headers:{...headers,'Idempotency-Key':uploadKey},multipart}); expect(retried.status()).toBe(201); expect(await retried.json()).toEqual(await uploaded.json());
  const commentFile={body:'دليل العمل',file:{name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('evidence fixture')}};
  const commentHeaders={...headers,'Idempotency-Key':`comment-${id}`};
  const comment=await page.request.post(`${root}/${id}/comment`,{headers:commentHeaders,multipart:commentFile}); expect(comment.status()).toBe(200);
  const commentRetry=await page.request.post(`${root}/${id}/comment`,{headers:commentHeaders,multipart:commentFile}); expect(commentRetry.status()).toBe(200); expect(await commentRetry.json()).toEqual(await comment.json());
  const moved=await page.request.post(`${root}/${id}/move`,{headers:{...headers,'Idempotency-Key':`move-${id}`},data:{stage:Number(review),evidence:'https://example.test/review'}}); expect(moved.status()).toBe(200);
  // A message to an agent is one card for a repeated key; a changed body, an unknown mode or a non-agent member is refused.
  const ask={message:`رسالة لوكيل ${Date.now()}`,agent:'30000000-0000-0000-0000-000000000005',mode:'answer'}; const askHeaders={...headers,'Idempotency-Key':`ask-${id}`};
  const asked=await page.request.post(root,{headers:askHeaders,data:ask}); expect(asked.status()).toBe(201);
  const askedAgain=await page.request.post(root,{headers:askHeaders,data:ask}); expect(askedAgain.status()).toBe(201); expect(await askedAgain.json()).toEqual(await asked.json());
  expect((await page.request.post(root,{headers:askHeaders,data:{...ask,message:'changed'}})).status()).toBe(409);
  expect((await page.request.post(root,{headers:{...headers,'Idempotency-Key':`mode-${id}`},data:{...ask,mode:'later'}})).status()).toBe(400);
  expect((await page.request.post(root,{headers:{...headers,'Idempotency-Key':`agent-${id}`},data:{...ask,agent:'30000000-0000-0000-0000-000000000004'}})).status()).toBe(404);
  await page.goto('/c/rs-learning/work/board'); await expect(page.locator('.card').filter({hasText:ask.message})).toHaveCount(1);
  await page.goto('/c/rs-learning/work/board'); await expect(page.getByText(title)).toBeVisible();
  await page.goto(`/c/rs-learning/work/board/${id}`); await expect(page.getByLabel('وكيل المحتوى').first()).toBeVisible(); await expect(page.getByText("Created the card")).toBeVisible(); await expect(page.getByRole('link',{name:"View evidence file"})).toBeVisible();
  await page.goto('/c/rs-learning/approvals'); const row=page.locator('.approval-card').filter({hasText:title}); await expect(row).toBeVisible(); await expect(row.getByLabel('وكيل المحتوى')).toBeVisible();
  // The decision is made inside the card (ADR 0013).
  await row.getByRole('link',{name:title}).click(); const decision=page.locator('[data-card-section="review"]'); await decision.getByText("Reject with a reason").click(); await decision.getByLabel("Rejection reason").fill('يرجى تعديل التصميم'); await decision.getByLabel("Design needs work",{exact:true}).check();
  const start=Date.now(); await decision.getByRole('button',{name:"Confirm rejection"}).click();
  await expect.poll(()=>received.length,{timeout:10000}).toBeGreaterThan(0); expect(Date.now()-start).toBeLessThan(10000);
  const message=received.find(x=>JSON.parse(x.body).event_type==='rejected'); expect(message).toBeTruthy();
  const event=JSON.parse(message!.body); expect(event.reason).toBe('يرجى تعديل التصميم'); expect(event.marked_parts.design).toBe(true); expect(event.card).toBe(id);
  expect(message!.signature).toBe(`sha256=${createHmac('sha256','fixture-webhook-secret').update(message!.body).digest('hex')}`);
  await page.goto('/c/rs-learning/settings/agents');
  const agentKey=page.locator('.section-title').filter({has:page.locator('strong',{hasText:'وكيل المحتوى'})}).first();
  await agentKey.getByRole('button',{name:'Revoke key وكيل المحتوى'}).click();
  await expect.poll(async()=> (await page.request.get(`${root}?next_actor=me`,{headers})).status()).toBe(401);

 } finally { await new Promise<void>((resolve,reject)=>receiver.close(err=>err?reject(err):resolve())); }
});

// The caption's lines survive the real save and a reload, in English and in Arabic; its height and direction are
// checked in components/card-detail.test.tsx.
test('a caption of several lines in English and Arabic survives saving and a reload',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/1');
 const caption=page.locator('textarea[name=caption]'); // Found by name: a label's accessible name grows with the text once the field has a value.
 const save=()=>Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), page.getByRole('button',{name:'Save changes'}).click()]);
 for(const text of ['First line\nSecond line\nThird line','السطر الأول\nالسطر الثاني\nالسطر الثالث']) {
  await caption.fill(text);
  await save();
  await page.reload();
  await expect(caption).toHaveValue(text);
 }
 await caption.fill('');
 await save(); // Leave the seeded card as the other tests expect it.
});

// The publishing date's form round trip: an unrelated save leaves the date as it was, and a changed date is read back
// as its activity on the Card and on Home. The phone layout of these controls is in components/card-detail.test.tsx.
test('an unrelated save keeps a Card\'s publishing date, and a changed date reads back on the Card and Home',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/2');
 const dates=page.locator('.detail-row').filter({hasText:'Updated publishing date'});
 const before=await dates.count();
 await page.getByLabel("Offering",{exact:true}).fill('عرض محدث دون تعديل الموعد');
 await page.getByRole('button',{name:"Save changes"}).click();
 await expect(page.getByText('Updated Offering: عرض محدث دون تعديل الموعد')).toBeVisible();
 await expect(dates).toHaveCount(before);
 await page.getByLabel("Publishing date",{exact:true}).fill('2032-11-12T12:00');
 await page.getByRole('button',{name:"Save changes"}).click();
 await expect(page.getByText('Updated publishing date: November 12')).toBeVisible();
 await page.goto('/c/rs-learning/home');
 await expect(page.locator('.detail-row').filter({has:page.locator('a[href="/c/rs-learning/work/board/2"]')}).getByText('Updated publishing date: November 12')).toBeVisible();
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
