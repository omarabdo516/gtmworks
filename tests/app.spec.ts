import { test, expect } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { signIn, chooseCompany } from './sign-in';
import { appOrigin } from './lane.mjs';
// Every page here is read in both languages at 1440, and the List and the Agents page also at 390. At 390 the next
// case reads the English faces (#257); Arabic at 390 is held to the design system (#805).
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
  for(const [path,width] of [...['home','work/board','work/calendar','work/list','approvals','agents','settings'].map(path=>[path,1440] as const),['work/list',390] as const,['agents',390] as const]) {
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

// Each page in English at 390 keeps Inter, has loaded every face it draws text
// in, and does not scroll sideways.
test('every page in English at 390 draws in faces that loaded, Inter for its own text',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await chooseLanguageInSettings(page,'en');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 for(const path of ['home','work/board','work/calendar','work/list','approvals','agents','settings']) {
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
 // #953: the legacy Members page keeps an Owner's way in, an Invite link form instead of the email invite.
 await expect(page.getByRole('button',{name:"Make an invite link"})).toBeVisible();
 const owner=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^عمر$/})}); await owner.getByRole('button',{name:"Remove"}).click(); await expect(page.getByRole('status').filter({hasText:'The last Administrator'})).toContainText('The last Administrator');
 const viewer=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); const roles=await viewer.getByRole('combobox',{name:"Member role",exact:true}).locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)); expect(roles).toEqual(['owner','manager','contributor','viewer']); await expect(viewer.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0); await viewer.getByRole('combobox',{name:"Member role",exact:true}).selectOption('contributor'); await viewer.getByLabel("Publishing").check(); await viewer.getByRole('button',{name:"Save"}).click(); await expect(page.getByRole('status').filter({hasText:'Change saved.'})).toContainText('Change saved.'); const changed=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); await expect(changed.getByRole('combobox',{name:"Member role",exact:true})).toHaveValue('contributor'); await expect(changed.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0); await changed.getByRole('combobox',{name:"Member role",exact:true}).selectOption('viewer'); await changed.getByLabel("Publishing").uncheck(); await changed.getByRole('button',{name:"Save"}).click(); await expect(changed.getByRole('combobox',{name:"Member role",exact:true})).toHaveValue('viewer'); await expect(changed.getByRole('combobox',{name:"Agent role",exact:true})).toHaveCount(0);
 expect((await page.goto('/all-brands'))?.status()).toBe(404);
 await context.clearCookies(); await signIn(page,'viewer@example.com','/c/rs-learning/settings/members'); await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible(); await expect(page.getByRole('button',{name:"Remove"})).toHaveCount(0); await expect(page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})})).toContainText("Viewer"); const res=await page.goto('/all-brands'); expect(res?.status()).toBe(404);
});

// A Manager is offered nothing guard_member refuses (#774): no control on an Owner's row, none on their own Role and
// Grants, and no way to make an Invite link, which is the Owner's alone (#950); they still change a Viewer as before.
test('a Manager has no control on an Owner\'s row or their own, and still changes a Viewer',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings/members');
 await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible();
 const row=(name:string)=>page.locator('.member-row').filter({has:page.locator('strong',{hasText:new RegExp(`^${name}$`)})});
 for(const name of ['عمر','مدير']) { await expect(row(name).getByRole('button',{name:"Remove"})).toHaveCount(0); await expect(row(name).getByRole('combobox')).toHaveCount(0); await expect(row(name).getByRole('checkbox')).toHaveCount(0); }
 await expect(row('عمر')).toContainText('Administrator');
 await expect(page.getByRole('button',{name:"Make an invite link"})).toHaveCount(0);
 await page.goto('/c/rs-learning/settings?section=members');
 await expect(page.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:"Make an invite link"})).toHaveCount(0);
 // The editable Members page is the standalone one; the overlay draws the Team table without its row forms.
 await page.goto('/c/rs-learning/settings/members');
 await row('مشاهد').getByLabel("Publishing").check(); await row('مشاهد').getByRole('button',{name:"Save"}).click();
 await expect(page.getByRole('status').filter({hasText:'Change saved.'})).toContainText('Change saved.');
 await expect(row('مشاهد').getByLabel("Publishing")).toBeChecked();
});

test('Invite link signs the new member into the company',async({page,context})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
 await page.getByRole('button',{name:"Make an invite link"}).click();
 await page.getByLabel("Person’s name").fill('Invited Person');
 await page.getByRole('button',{name:"Make the link"}).click();
 const link=await page.getByLabel('Invite link for Invited Person').inputValue();
 expect(link).toMatch(/\/join#code=[a-f0-9]{64}$/);
 await context.clearCookies(); await page.goto(link);
 // A new Person chooses a password on the link's page before the Company opens (#41, #950).
 await page.getByLabel('Your name').fill('Invited Person'); await page.getByLabel('Email').fill('invited@example.com');
 await page.getByLabel('Password',{exact:true}).fill('invited-password'); await page.getByLabel('Confirm password').fill('invited-password');
 await page.getByRole('button',{name:'Join and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/); await expect(page.locator('.home-dashboard')).toBeVisible();
});

test('the Owner of every company lands on a Company home from the sign-in page and opens each one with no extra verification step',async({page})=>{
 // Signing in from the sign-in page itself, with no page asked for, lands a person of several companies on a Company home.
 await signIn(page,'omar@example.com','/sign-in'); await expect(page).toHaveURL(/\/c\/[^/]+\/home$/);
 await page.goto('/c/rs-learning/home'); await expect(page.locator('.home-dashboard')).toBeVisible();
 for(const slug of ['rs-consultations','aleem']) { await chooseCompany(page,slug); await expect(page).toHaveURL(new RegExp(`/c/${slug}/home$`)); await expect(page.locator('.home-dashboard')).toBeVisible(); }
});

test('the old agent API routes answer not found', async ({request}) => {
 const key={Authorization:'Bearer agt_local_fixture_for_tests_only'};
 const root='/api/v1/companies/rs-learning';
 for(const [method,path] of [['GET',`${root}/cards?next_actor=me`],['POST',`${root}/cards`],['PATCH',`${root}/cards/1`],['POST',`${root}/cards/1/comment`],
  ['POST',`${root}/cards/1/run-keys`],['DELETE',`${root}/cards/1/run-keys`],['GET',`${root}/skills`],['GET',`${root}/cards/1/files/1`]] as const)
  for(const headers of [key,{}]) expect((await request.fetch(path,{method,headers,data:method==='GET'||method==='DELETE'?undefined:{}})).status(),`${method} ${path}`).toBe(404);
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
