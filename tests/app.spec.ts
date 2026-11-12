import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { signIn, chooseCompany, openNavigation } from './sign-in';
import { idle } from './navigation-measure';
test('public contains no font files, including renamed font binaries',async()=>{
 const entries=await readdir('public',{recursive:true,withFileTypes:true}).catch(error=>{if(error.code==='ENOENT') return []; throw error;});
 for(const entry of entries.filter(entry=>entry.isFile())) {
  expect(entry.name).not.toMatch(/\.(?:otf|ttf|woff2?|eot|ttc)$/i);
  const bytes=await readFile(`${entry.parentPath}/${entry.name}`);
  expect(['OTTO','wOFF','wOF2','ttcf','true','typ1']).not.toContain(bytes.subarray(0,4).toString('ascii'));
  expect(bytes.subarray(0,4).equals(Buffer.from([0,1,0,0]))).toBe(false);
 }
});

test('sign-in artwork renders, animates and respects reduced motion in both languages',async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/sign-in');
 const artwork=page.locator('pre[aria-hidden=true]');
 for(const language of ['en','ar']) {
  await page.locator('select').selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  await page.evaluate(()=>document.fonts.ready);
  await expect(artwork).toBeInViewport({ratio:1});
  await expect(artwork).toContainText('╭');
  const frame=await artwork.textContent();
  await page.waitForTimeout(150);
  await expect(artwork).toHaveText(frame!);
  await page.screenshot({path:`test-results/screenshots/sign-in-${language}-1440.png`});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect.poll(()=>artwork.textContent()).not.toBe(frame);
  await expect(artwork).toContainText('│',{timeout:10000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(artwork).toContainText('╭');
  await page.setViewportSize({width:390,height:900});
  await expect(artwork).toBeHidden();
  await expect(page.getByRole('textbox')).toBeInViewport({ratio:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:`test-results/screenshots/sign-in-${language}-390.png`});
  await page.setViewportSize({width:1440,height:900});
 }
});

for(const width of [1440,390]) test(`Paperclip Inter and Arabic-only Vazirmatn load locally at ${width}px`,async({page,context})=>{
 const fontRequests:string[]=[];
 const externalFonts:string[]=[];
 context.on('request',request=>{
  const url=new URL(request.url());
  if(request.resourceType()==='font'||/\.(?:otf|ttf|woff2?|eot)(?:$|\?)/i.test(url.pathname)) fontRequests.push(request.url());
  if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) externalFonts.push(request.url());
 });
 await page.setViewportSize({width,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 for(const language of ['en','ar']) {
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption(language);
  await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  for(const path of ['home','work/board','work/board/1','work/calendar','work/list','approvals','agents','settings']) {
   await page.goto(`/c/rs-learning/${path}`);
   await page.evaluate(()=>document.fonts.ready);
   const family=await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''));
   expect(family).toMatch(language==='en'?/^InterVariable$/:/^(?:__)?Vazirmatn(?:_|$)/);
   expect(await page.evaluate(font=>Array.from(document.fonts).some(face=>face.family.replaceAll(/["']/g,'')===font&&face.status==='loaded'),family)).toBe(true);
   for(const el of await page.locator('.content h1,.content h2,.content h3,.modal h2').all()) expect(await el.evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''))).toBe(family);
   // The shell takes the approved reference's face (IBM Plex Sans Arabic) in both languages.
   if(width===1440) for(const heading of await page.locator('.sidebar .sb-label').all()) expect(await heading.evaluate(el=>getComputedStyle(el).fontFamily.split(',')[0].trim().replaceAll(/["']/g,''))).toMatch(/^(?:__)?IBM[_ ]Plex[_ ]Sans[_ ]Arabic(?:_|$)/);
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
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption('en');
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 expect(fontRequests.length).toBeGreaterThan(0);
 for(const request of fontRequests) {
  const url=new URL(request);
  expect(url.origin).toBe('http://127.0.0.1:3000');
  expect(url.pathname).toMatch(/^\/_next\/static\/media\/[^/]+$/);
 }
 expect(externalFonts).toEqual([]);
});

test('the new-card dialog opened from the board closes with Escape and with its close button',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'manager@example.com','/c/rs-learning/work/board');
 const dialog=page.getByRole('dialog');
 await page.getByRole('button',{name:'+ New card'}).first().click();
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'+ Add card'}).first().click();
 await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog).toHaveCount(0);
});

test('the new-card dialog closes in place on List and Calendar and returns to the board from /work/new',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'manager@example.com','/c/rs-learning/work/board');
 const dialog=page.getByRole('dialog');
 for(const view of ['list','calendar']) {
  const url=new RegExp(`/work/${view}$`);
  await page.goto(`/c/rs-learning/work/${view}`);
  await page.getByRole('button',{name:'+ New card'}).first().click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await page.getByRole('button',{name:'+ New card'}).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(url);
 }
 await page.goto('/c/rs-learning/work/new');
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/work\/board$/);
});

for(const width of [1440,390]) test(`card creation fits the viewport and detail keeps its title and close clear at ${width}px`,async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 await page.setViewportSize({width,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/1');
 for(const language of ['en','ar']) {
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption(language);
  await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  await page.goto('/c/rs-learning/work/new');
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeInViewport({ratio:1});
  const bounds=(await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(900);
  await page.screenshot({path:`test-results/screenshots/work-new-${language}-${width}.png`});
  await page.getByRole('button',{name:language==='en'?'Close':'إغلاق',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/c/rs-learning/work/board/1');
  const crumbs=page.locator('.topbar [data-slot="breadcrumb"] li:not([role="presentation"])');
  await expect(crumbs).toHaveCount(2);
  await expect(crumbs.first()).toHaveText(language==='en'?'Work':'العمل');
  await expect(crumbs.first().locator('a')).toHaveAttribute('href','/c/rs-learning/work/board');
  await expect(crumbs.last()).not.toHaveText('');
  const heading=page.locator('.card-detail h2').first();
  const close=page.getByRole('link',{name:language==='en'?'Close':'إغلاق',exact:true});
  await expect(heading).toBeInViewport({ratio:1});
  await expect(close).toBeInViewport({ratio:1});
  const title=await heading.evaluate(el=>{
   const range=document.createRange();range.selectNodeContents(el);
   const text=range.getBoundingClientRect(),box=el.getBoundingClientRect();
   return {fits:text.left>=box.left&&text.right<=box.right,lines:new Set(Array.from(range.getClientRects()).map(rect=>Math.round(rect.y))).size};
  });
  expect(title).toEqual({fits:true,lines:1});
  const titleBox=(await heading.boundingBox())!,closeBox=(await close.boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  expect(closeBox.y).toBeLessThanOrEqual(titleBox.y);
  expect(language==='ar'?closeBox.x+closeBox.width<=titleBox.x:titleBox.x+titleBox.width<=closeBox.x).toBe(true);
  await page.screenshot({path:`test-results/screenshots/card-detail-${language}-${width}.png`});
  // Detail is a page now: its editor scrolls, while creation remains a bounded dialog.
  await page.getByLabel(language==='en'?'Comment':'التعليق',{exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByLabel(language==='en'?'Comment':'التعليق',{exact:true})).toBeInViewport({ratio:1});
  await close.click();
  await expect(page).toHaveURL(/\/work\/board$/);
 }
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption('en');
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
});

test('sign-in returns to requested page, company switch preserves section, and access is isolated',async({page})=>{
 await signIn(page,'multi@example.com','/c/rs-learning/approvals'); await expect(page).toHaveURL(/\/c\/rs-learning\/approvals/); await chooseCompany(page,'aleem'); await expect(page).toHaveURL(/\/c\/aleem\/approvals/); const response=await page.goto('/c/rs-consultations/home'); expect(response?.status()).toBe(404); const unknown=await page.goto('/c/unknown/home'); expect(unknown?.status()).toBe(404);
});
test('landing and screenshots of every charter route',async({page})=>{
 await signIn(page,'omar@example.com','/sign-in'); await expect(page).toHaveURL(/\/c\/[^/]+\/home/); await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); for(const path of ['/sign-in','/c/rs-learning/home','/c/rs-learning/approvals','/c/rs-learning/settings']) { await page.goto(path); await page.screenshot({path:`test-results/screenshots/${path.slice(1).replaceAll('/','-')}-${width}.png`,fullPage:true}); } }
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
 await context.addCookies(chunks.map((value, index) => ({name: chunks.length === 1 ? baseName : `${baseName}.${index}`, value, url:'http://127.0.0.1:3000'})));
 await page.goto('/c/rs-learning/approvals');
 await expect(page).toHaveURL(/\/c\/rs-learning\/approvals/);
 const refreshed = (await readCookies()).map(cookie => cookie.value).join('');
 const newSession = JSON.parse(Buffer.from(refreshed.slice(7), 'base64url').toString('utf8'));
 expect(newSession.refresh_token).not.toBe(oldRefreshToken);
 await page.goto('/c/rs-learning/home');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home/);
});

test('members controls, viewer access, and agency gate',async({page,context})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings/members');
 await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible();
 const owner=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^عمر$/})}); await owner.getByRole('button',{name:"Remove"}).click(); await expect(page.getByRole('status')).toContainText('The last owner');
 const viewer=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); await viewer.getByLabel("Role").selectOption('reviewer'); await viewer.getByLabel("Publishing").check(); await viewer.getByRole('button',{name:"Save"}).click(); await expect(page.getByRole('status')).toContainText('Change saved.'); const changed=page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})}); await expect(changed.getByLabel("Role")).toHaveValue('reviewer'); await changed.getByLabel("Role").selectOption('viewer'); await changed.getByRole('button',{name:"Save"}).click();
 await page.goto('/all-brands'); await expect(page.getByRole('heading',{name:"Two-step verification"})).toBeVisible(); await expect(page.locator('.company-card')).toHaveCount(0);
 await context.clearCookies(); await signIn(page,'viewer@example.com','/c/rs-learning/settings/members'); await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible(); await expect(page.getByRole('button',{name:"Remove"})).toHaveCount(0); await expect(page.locator('.member-row').filter({has:page.locator('strong',{hasText:/^مشاهد$/})})).toContainText("Viewer"); const res=await page.goto('/all-brands'); expect(res?.status()).toBe(404);
});

test('screenshots for unit routes',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings/members'); await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); for(const path of ['/c/rs-learning/settings/members','/c/rs-learning/settings/agents','/all-brands']) { await page.goto(path); await page.screenshot({path:`test-results/screenshots/${path.slice(1).replaceAll('/','-')}-${width}.png`,fullPage:true}); } }
});

test('invite link signs the new member into the company',async({page,context})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings/members');
 await page.request.delete('http://127.0.0.1:54324/api/v1/messages');
 await page.getByLabel("Email").fill('invited@example.com'); await page.getByRole('button',{name:"Send invitation"}).click(); await expect(page.getByRole('status')).toContainText('An invitation link was sent');
 let link=''; for(let i=0;i<30&&!link;i++){const mailbox=await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json(); const item=mailbox.messages?.find((m:{To:{Address:string}[]})=>m.To.some(t=>t.Address==='invited@example.com')); if(item){const message=await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${item.ID}`)).json(); link=(message.HTML||message.Text).match(/https?:\/\/[^"\s<>]+/g)?.find((url:string)=>url.includes('/verify'))?.replaceAll('&amp;','&')||'';} if(!link) await page.waitForTimeout(1000);}
 expect(link).toBeTruthy(); await context.clearCookies(); await page.goto(link); await expect(page).toHaveURL(/\/c\/rs-learning\/settings\/members/); await expect(page.getByRole('heading',{name:"Team members"})).toBeVisible();
});

function totp(secret:string) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=''; for(const c of secret.replace(/=+$/,'').toUpperCase()) bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g)?.map(b=>parseInt(b,2)) || []); const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000))); const hash=createHmac('sha1',key).update(counter).digest(); const offset=hash[19]&15; return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
test('agency owner enrols TOTP and sees all companies after verification',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings'); await page.goto('/all-brands'); await expect(page.getByRole('heading',{name:"Two-step verification"})).toBeVisible();
 await page.getByRole('button',{name:"Set up authenticator"}).click(); const secret=await page.locator('code').textContent(); expect(secret).toBeTruthy(); await page.getByLabel("Verification code").fill(totp(secret!)); await page.getByRole('button',{name:"Verify",exact:true}).click(); await expect(page.locator('.company-card')).toHaveCount(3);
 await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/all-brands-verified-${width}.png`,fullPage:true}); }
 await page.getByRole('link',{name:/RS Learning/}).last().click(); await expect(page).toHaveURL(/\/c\/rs-learning\/home/);
});

test('member and invitation controls have mobile touch targets',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/settings/members');
 const labels=page.locator('.member-form label, .invite-form label');
 expect(await labels.count()).toBeGreaterThan(0);
 for(const label of await labels.all()) { const box=await label.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(44); }
 const controls=page.locator('.member-form button, .invite-form button, .member-form select, .invite-form select, .invite-form input[type=email]');
 for(const control of await controls.all()) { const box=await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(44); }
 for(const checkbox of await page.locator('.member-form input[type=checkbox], .invite-form input[type=checkbox]').all()) { const box=await checkbox.boundingBox(); expect(box).not.toBeNull(); expect(box!.width).toBeGreaterThanOrEqual(22); expect(box!.height).toBeGreaterThanOrEqual(22); }
});


test('work routes and template card',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(page.getByText('أفكار',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:"+ Add card"}).first().click();
 await page.getByLabel("Card title").fill('اختبار ريل');
 await page.getByLabel("Template").selectOption('reel');
 await page.getByRole('button',{name:"Create card"}).click();
 await expect(page.getByText('Script Ready')).toBeVisible();
 await mkdir('test-results/screenshots',{recursive:true});
 for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); for(const path of ['/c/rs-learning/work/board','/c/rs-learning/work/board/1','/c/rs-learning/work/calendar','/c/rs-learning/work/list','/c/rs-learning/settings/work']) { await page.goto(path); await page.screenshot({path:`test-results/screenshots/${path.slice(1).replaceAll('/','-')}-${width}.png`,fullPage:true}); } }
});


test('board moves, date filtering, creative versions and shared card views',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const boardCard=page.locator('.card[data-card-id="1"]');
 const cardTitle=(await boardCard.locator('strong').textContent())!;
 const destination=page.locator('.column[data-stage-name="بريف جاهز"]');
 const sourceBox=(await boardCard.boundingBox())!,targetBox=(await destination.locator('.column-body').boundingBox())!;
 await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+20);
 await page.mouse.down();
 await page.mouse.move(sourceBox.x+sourceBox.width/2+8,sourceBox.y+20,{steps:2});
 await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+40,{steps:10});
 await page.mouse.up();
 await expect(destination.locator('.card[data-card-id="1"]')).toBeVisible();
 await destination.locator('.card[data-card-id="1"] a').click();
 const stageId=await page.locator('select[aria-label="Move to list"] option').filter({hasText:'كتابة'}).getAttribute('value');
 await page.getByLabel("Move to list").selectOption(stageId!);
 await expect(page.locator('.card-stage-line')).toContainText('كتابة');
 await page.goto('/c/rs-learning/work/board');
 await expect(page.locator('.column[data-stage-name="كتابة"] .card[data-card-id="1"]')).toBeVisible();
 await page.getByLabel("Month").fill('2000-01');
 await expect(page.locator('.card[data-card-id="1"]')).toHaveCount(0);
 await page.getByLabel("Month").fill('');
 await page.locator('.card[data-card-id="1"] a').click();
 await page.getByLabel("Offering", {exact:true}).fill('عرض للاختبار');
 await page.getByLabel("Publishing date", {exact:true}).fill('2026-11-12T12:00');
 await page.getByRole('button',{name:"Save changes"}).click();
 await expect(page.getByText('Updated Offering: عرض للاختبار')).toBeVisible();
 const file={name:'تصميم.png',mimeType:'image/png',buffer:Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64'), Buffer.alloc(1024*1024)])};
 await page.getByLabel('New design file').setInputFiles(file);
 await page.getByRole('button',{name:"Add design"}).click();
 await expect(page.getByText(/Version 1:/)).toBeVisible();
 await page.locator('input[type=file]').first().setInputFiles(file);
 await page.getByRole('button',{name:"Upload version"}).first().click();
 await expect(page.getByText(/Version 2:/)).toBeVisible();
 await page.goto('/c/rs-learning/work/calendar');
 await page.getByLabel("Month").fill('2026-11');
 await page.locator('.calendar').getByRole('link',{name:cardTitle}).click();
 await expect(page).toHaveURL(/work\/board\/1/);
 await page.goto('/c/rs-learning/work/list');
 await page.locator('.table').getByRole('link',{name:cardTitle}).click();
 await expect(page).toHaveURL(/work\/board\/1/);
});


test.describe('touch board',()=>{
 test.use({hasTouch:true,viewport:{width:390,height:844}});
 test('touch drag moves a card on a phone',async({page})=>{
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  const card=page.locator('.card[data-card-id="1"]');
  await expect(card).toBeVisible();
  const stageOf=async()=>(await card.locator('xpath=ancestor::*[@data-stage-id]').getAttribute('data-stage-id'))!;
  // Earlier tests leave card 1 in a later list; start from the first list and put the card back where it was at the end.
  const originalStage=await stageOf();
  const first=page.locator('.column[data-stage-id]').first();
  const startStage=(await first.getAttribute('data-stage-id'))!,startName=(await first.getAttribute('data-stage-name'))!;
  const originalName=(await page.locator(`.column[data-stage-id="${originalStage}"]`).getAttribute('data-stage-name'))!;
  const moveByForm=async(stage:string,name:string)=>{
   await page.goto('/c/rs-learning/work/board/1');
   await page.getByLabel('Move to list',{exact:true}).selectOption(stage);
   await expect(page.locator('.card-stage-line')).toContainText(name);
   await page.goto('/c/rs-learning/work/board');
   await expect(page.locator(`.column[data-stage-id="${stage}"] .card[data-card-id="1"]`)).toBeVisible();
  };
  if(originalStage!==startStage) await moveByForm(startStage,startName);
  try {
   const destination=page.locator(`.column[data-stage-id="${startStage}"]`).locator('xpath=following-sibling::*[@data-stage-id][1]');
   const destinationStage=(await destination.getAttribute('data-stage-id'))!;
   const cdp=await page.context().newCDPSession(page);
   const touch=async(type:'touchStart'|'touchMove'|'touchEnd',x?:number,y?:number)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:x!,y:y!,id:1}]});};
   const cardStages=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.card[data-card-id]')].map(c=>[c.getAttribute('data-card-id'),c.closest('[data-stage-id]')!.getAttribute('data-stage-id')])));
   const scrollLeft=()=>page.evaluate(()=>Math.abs(document.querySelector('.board')!.scrollLeft));
   // +1 when the board reads left to right, -1 when it reads right to left: a finger moving against the reading direction scrolls toward the later lists.
   const dir=await page.evaluate(()=>getComputedStyle(document.querySelector('.board')!).direction==='rtl'?-1:1);
   const before=await cardStages();
   // A plain swipe starting on a card scrolls the board and moves no card.
   const scrolled=await scrollLeft();
   const swipeBox=(await card.boundingBox())!,swipeX=swipeBox.x+swipeBox.width/2,swipeY=swipeBox.y+12;
   await touch('touchStart',swipeX,swipeY);
   for(let step=1;step<=12;step++) { await touch('touchMove',swipeX-dir*step*14,swipeY); await page.waitForTimeout(16); }
   await touch('touchEnd');
   await expect.poll(scrollLeft,{message:'the board scrolled under the swipe'}).toBeGreaterThan(scrolled);
   await expect(page.getByText('Moving card…')).toHaveCount(0);
   expect(await cardStages()).toEqual(before);
   // Scroll the board so most of the card's list is off screen at its start side and the next list is beside it, then hold the card and carry it across.
   await page.evaluate(([direction,stage])=>{document.querySelector('.card[data-card-id="1"]')!.scrollIntoView({block:'center'});const board=document.querySelector('.board')!,box=board.querySelector(`.column[data-stage-id="${stage}"]`)!.getBoundingClientRect(),area=board.getBoundingClientRect();board.scrollLeft+=direction>0?box.left-area.left+box.width*0.6:-(area.right-box.right+box.width*0.6);},[dir,startStage] as [number,string]);
   await page.evaluate(()=>{const w=window as unknown as {pointerCancels:number};w.pointerCancels=0;window.addEventListener('pointercancel',()=>{w.pointerCancels++;},true);});
   const cardBox=(await card.boundingBox())!,targetBox=(await destination.locator('.column-body').boundingBox())!,boardBox=(await page.locator('.board').boundingBox())!;
   const viewport=page.viewportSize()!;
   // Grab the part of the card still in view; drop in the middle of the next list, or as near as the screen edge keeps clear of the board's edge scrolling.
   const fromX=dir>0?(Math.max(cardBox.x,boardBox.x+2)+cardBox.x+cardBox.width)/2:(cardBox.x+Math.min(cardBox.x+cardBox.width,boardBox.x+boardBox.width-2))/2,fromY=cardBox.y+12;
   const toX=dir>0?Math.min(targetBox.x+targetBox.width/2,viewport.width-60):Math.max(targetBox.x+targetBox.width/2,60),toY=targetBox.y+40;
   expect(Math.abs(toX-(targetBox.x+targetBox.width/2)),'the next list is on screen').toBeLessThan(targetBox.width/2);
   await touch('touchStart',fromX,fromY);
   await page.waitForTimeout(450);
   for(let step=1;step<=15;step++) { await touch('touchMove',fromX+(toX-fromX)*step/15,fromY+(toY-fromY)*step/15); await page.waitForTimeout(30); }
   await page.waitForTimeout(150);
   await touch('touchEnd');
   expect(await page.evaluate(()=>(window as unknown as {pointerCancels:number}).pointerCancels),'no pointercancel ends the drag').toBe(0);
   await expect(page.locator(`.column[data-stage-id="${destinationStage}"] .card[data-card-id="1"]`)).toBeVisible();
   await expect(page.getByText('Moving card…')).toHaveCount(0);
   await page.reload();
   await expect(page.locator(`.column[data-stage-id="${destinationStage}"] .card[data-card-id="1"]`)).toBeVisible();
   expect(await cardStages()).toEqual({...before,'1':destinationStage});
  } finally {
   await moveByForm(originalStage,originalName);
  }
 });
});

test('card close control is in the title row with a 44px target',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/1');
 try {
  for(const language of ['en','ar']) {
   await page.goto('/c/rs-learning/settings');
   await page.locator('select[name=language]').selectOption(language);
   await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
   await expect(page.locator('html')).toHaveAttribute('lang',language);
   for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto('/c/rs-learning/work/board/1');
    const heading=page.locator('.card-detail h2').first();
    const close=page.getByRole('link',{name:language==='en'?'Close':'إغلاق',exact:true});
    await expect(heading).toBeVisible();
    const titleBox=(await heading.boundingBox())!,closeBox=(await close.boundingBox())!;
    expect(closeBox.width,`${language} ${width}: close width`).toBeGreaterThanOrEqual(44);
    expect(closeBox.height,`${language} ${width}: close height`).toBeGreaterThanOrEqual(44);
    // It shares the title's row: the two boxes overlap vertically, and the close sits at the inline end.
    expect(closeBox.y,`${language} ${width}: close starts above the title ends`).toBeLessThan(titleBox.y+titleBox.height);
    expect(closeBox.y+closeBox.height,`${language} ${width}: close ends below the title starts`).toBeGreaterThan(titleBox.y);
    expect(language==='ar'?closeBox.x+closeBox.width<=titleBox.x+1:titleBox.x+titleBox.width<=closeBox.x+1,`${language} ${width}: close at the inline end`).toBe(true);
    await close.click();
    await expect(page).toHaveURL(/\/c\/rs-learning\/work\/board$/);
   }
  }
 } finally {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption('en');
  await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
 }
});

test('date edits are accurate and work controls are accessible on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await page.goto('/c/rs-learning/work/board/2');
 await page.locator('.modal').evaluate(async modal=>{
  await Promise.all(modal.getAnimations().map(animation=>animation.finished));
 });
 const stageSelect=page.getByLabel("Move to list");
 expect((await stageSelect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await expect(page.getByRole('link',{name:"Close"})).toBeVisible();
 for(const name of ["Next actor","Add assignee","Add label","New design file","Comment"]) await expect(page.getByLabel(name,{exact:true})).toBeVisible();
 const checkbox=page.locator('.checklist input[type=checkbox]').first();
 expect((await checkbox.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
 await page.goto('/c/rs-learning/settings/work');
 for(const name of ['Stage name أفكار','Stage order أفكار','Label name static','Label color static']) await expect(page.getByLabel(name,{exact:true})).toBeVisible();
});


// Each stage test works on its own card. A card that reached Review cannot leave it without a decision, so a shared card
// would start the next test (or the next repeat) already in Review and the move under test would change nothing.
async function createCard(page: Page, label: string, info: TestInfo) {
 await page.goto('/c/rs-learning/work/new');
 await page.getByLabel('Message',{exact:true}).fill(`${label} ${info.workerIndex}-${info.repeatEachIndex}-${Date.now()}`);
 await page.getByRole('button', { name: 'Create card' }).click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/);
 return new URL(page.url()).pathname;
}

test('card stage control waits for hydration and persists the selected stage', async ({ page: sessionPage }, info) => {
 await signIn(sessionPage, 'omar@example.com', '/c/rs-learning/work/new');
 const cardPath = await createCard(sessionPage, 'Hydration stage', info);
 const page = await sessionPage.context().newPage();
 let release!: () => void;
 const hydration = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/_next/static/**/*.js', async route => {
  await hydration;
  await route.continue();
 });
 try {
  await page.goto(cardPath, { waitUntil: 'commit' });
  const stage = page.getByLabel('Move to list', { exact: true });
  await expect(stage).toBeVisible();
  await expect(stage).toBeDisabled();
  release();
  await expect(stage).toBeEnabled();
  await stage.selectOption({ label: 'مراجعة' });
  await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
  await page.reload();
  await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 } finally {
  release();
  await page.close();
 }
});

test('card stage control and work settings navigation',async({page},info)=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/new');
 await createCard(page,'Stage control',info);
 await expect(page.locator('.card-stage-line')).toContainText("In stage");
 await expect(page.locator('.card-stage-line')).not.toContainText('مراجعة');
 await page.getByLabel("Move to list",{exact:true}).selectOption({label:'مراجعة'});
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 await page.getByLabel("Comment",{exact:true}).fill('تعليق للاختبار');
 await page.getByRole('button',{name:"Send",exact:true}).click();
 await expect(page.locator('.detail-row').filter({hasText:'تعليق للاختبار'})).toContainText('عمر');
 await page.goto('/c/rs-learning/settings/work');
 await expect(page.getByRole('link',{name:"General",exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:"Members",exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:"+ New card"})).toHaveCount(0);
});

test('mobile card shows workflow controls first', async ({ page }, info) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/work/new');
 await page.setViewportSize({ width: 390, height: 900 });
 // The stage still saves from its new place: change it on a card of its own and see it after a reload.
 await createCard(page, 'Mobile stage', info);
 await page.getByLabel('Move to list', { exact: true }).selectOption({ label: 'مراجعة' });
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 await page.reload();
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 const box = async (locator: ReturnType<Page['locator']>) => { await expect(locator).toBeVisible(); return (await locator.boundingBox())!; };
 // A card waiting for this reviewer keeps the decision after the record, below the edit form.
 const waiting = [await box(page.locator('[data-card-section="labels"]')), await box(page.locator('.modal-grid > div form').first()), await box(page.locator('[data-card-section="review"]'))];
 expect(waiting[0].y + waiting[0].height).toBeLessThanOrEqual(waiting[1].y);
 expect(waiting[2].y).toBeGreaterThan(waiting[1].y + waiting[1].height);
 try {
  for (const language of ['en', 'ar']) {
   await page.setViewportSize({ width: 1440, height: 900 });
   await page.goto('/c/rs-learning/settings');
   await page.locator('select[name=language]').selectOption(language);
   await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
   await expect(page.locator('html')).toHaveAttribute('lang', language);
   for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/c/rs-learning/work/board/1');
    const section = (name: string) => page.locator(`[data-card-section="${name}"]`);
    const title = await box(page.locator('.card-detail h2').first());
    const stage = await box(section('stage'));
    const actor = await box(section('next-actor'));
    const form = await box(page.locator('.modal-grid > div form').first());
    if (width === 390) {
     expect(actor.y + actor.height).toBeLessThanOrEqual(900);
     const assignees = await box(section('assignees'));
     const labels = await box(section('labels'));
     const order = [title, stage, actor, assignees, labels, form].map(item => item.y);
     expect(order).toEqual([...order].sort((a, b) => a - b));
     expect(new Set(order).size).toBe(order.length);
     expect(stage.y).toBeGreaterThanOrEqual(title.y + title.height);
     expect(labels.y + labels.height).toBeLessThanOrEqual(form.y);
    } else {
     expect(stage.y).toBeLessThanOrEqual(260);
     // Beside the record, not below it: after the form's end side in English, before its start side in Arabic.
     if (language === 'ar') expect(stage.x + stage.width).toBeLessThanOrEqual(form.x + 1);
     else expect(stage.x).toBeGreaterThanOrEqual(form.x + form.width - 1);
     expect(stage.y).toBeLessThan(form.y + form.height);
    }
   }
  }
 } finally {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption('en');
  await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
 }
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
 await page.goto('/c/rs-learning/approvals');
 const queued=page.locator('.approval-card').filter({hasText:title});
 await expect(queued).toBeVisible();
 const count=await page.locator('.approval-card').count();
 await expect(page.locator('.sidebar .sb-count[href$="/approvals"]')).toHaveText(String(count));
 await expect(queued.getByRole('link',{name:/View card/})).toHaveAttribute('href',new URL(cardUrl).pathname);
 await queued.locator('.approval-expand > summary').click();
 await expect(queued).toContainText('نص مخصص للمراجعة');
 await expect(queued).toContainText('عرض مخصص للمراجعة');
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/approvals')), queued.getByRole('button',{name:"Approve"}).click()]);
 await page.reload();
 await expect(page.locator('.approval-card').filter({hasText:title})).toBeVisible();
 const second=page.locator('.approval-card').filter({hasText:title});
 if(!await second.locator('.approval-expand').evaluate(el=>el.hasAttribute('open'))) await second.locator('.approval-expand > summary').click();
 await page.locator('.approval-card').filter({hasText:title}).getByRole('button',{name:"Approve"}).click();
 await expect(page.locator('.approval-card').filter({hasText:title})).toHaveCount(0);
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
 const row=page.locator('.approval-card').filter({hasText:rejected});
 await row.locator('.approval-expand > summary').click();
 await row.getByText("Reject with a reason").click();
 await row.getByLabel("Rejection reason").fill('يرجى تعديل التصميم');
 await row.getByLabel("Design",{exact:true}).check();
 await row.getByRole('button',{name:"Confirm rejection"}).click();
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
  await expect(page.getByRole('status')).toContainText('Notification settings saved.');
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
  await row.locator('.approval-expand > summary').click(); await row.getByText("Reject with a reason").click(); await row.getByLabel("Rejection reason").fill('يرجى تعديل التصميم'); await row.getByLabel("Design",{exact:true}).check();
  const start=Date.now(); await row.getByRole('button',{name:"Confirm rejection"}).click();
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

// Contrast is computed from what the browser draws: the text color (with its own opacity and its parents' opacity) laid over
// the background colors stacked behind it, so a faded copy of a darker color is measured as faded.
async function textContrast(page: Page, selector: string, pseudo?: string) {
 return page.evaluate(({ selector, pseudo }) => {
  const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
  const rgba = (css: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = css; context.fillRect(0, 0, 1, 1); const d = context.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
  const light = (color: number[]) => { const [r, g, b] = color.slice(0, 3).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const bodyColor = rgba(getComputedStyle(document.body).color);
  return Array.from(document.querySelectorAll(selector)).filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'; }).map(element => {
   let background = [255, 255, 255];
   const chain: Element[] = []; let opacity = 1;
   for (let node: Element | null = element; node; node = node.parentElement) { chain.unshift(node); opacity *= Number(getComputedStyle(node).opacity); }
   for (const node of chain) background = over(rgba(getComputedStyle(node).backgroundColor), background);
   const style = getComputedStyle(element, pseudo);
   const color = rgba(style.color);
   const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
   const body = over([bodyColor[0], bodyColor[1], bodyColor[2], bodyColor[3]], background);
   return { text: (element.textContent || (element as HTMLTextAreaElement).placeholder || '').trim(), secondary: ratio(shown, background), body: ratio(body, background) };
  });
 }, { selector, pseudo });
}

test('secondary text meets 4.5 to 1 contrast', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/home');
 const setLanguage = async (language: string) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption(language);
  await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
 };
 const seen: string[] = [];
 const check = async (kind: string, selector: string, pseudo?: string) => {
  const found = await textContrast(page, selector, pseudo);
  expect(found.length, `${kind}: nothing to measure`).toBeGreaterThan(0);
  for (const item of found) {
   expect(item.secondary, `${kind} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
   expect(item.secondary, `${kind} "${item.text}" must stay weaker than body text`).toBeLessThan(item.body);
  }
  seen.push(kind);
 };
 try {
  for (const language of ['en', 'ar']) {
   await setLanguage(language);
   for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/c/rs-learning/home');
    await idle(page);
    await check(`chart subtitle ${language} ${width}`, '.home-charts article h2 + span');
    await openNavigation(page);
    await check(`sidebar heading ${language} ${width}`, '.sidebar .sb-label');
    await page.goto('/c/rs-learning/work/board');
    await idle(page);
    await check(`toolbar label ${language} ${width}`, '.work-toolbar .tabs a:not(.active), .work-toolbar .tabs button:not(.active)');
    await page.goto('/c/rs-learning/work/board/1');
    await idle(page);
    await check(`comment placeholder ${language} ${width}`, '.modal textarea[name=body]', '::placeholder');
   }
  }
  expect(seen.length).toBe(16);
 } finally {
  await setLanguage('en');
 }
});

for(const width of [390,1440]) test(`caption keeps several lines at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/1');
 await page.goto('/c/rs-learning/work/board/1');
 const caption=page.locator('textarea[name=caption]'); // Found by name: a label's accessible name grows with the text once the field has a value.
 await expect(page.getByLabel('Caption',{exact:true})).toHaveJSProperty('name','caption'); // Labelled while still empty.
 await expect(caption).toHaveJSProperty('tagName','TEXTAREA');
 const empty=await caption.evaluate(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)}));
 expect(empty.height).toBeGreaterThanOrEqual(empty.lineHeight*4);
 for(const other of ['title','offering','segment','hook','channel','goal']) await expect(page.locator(`[name=${other}]`),`${other} stays single-line`).toHaveJSProperty('tagName','INPUT');
 const english='First line\nSecond line\nThird line';
 await caption.fill(english);
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), page.getByRole('button',{name:'Save changes'}).click()]);
 await page.reload();
 await expect(page.locator('textarea[name=caption]')).toHaveValue(english);
 const arabic='السطر الأول\nالسطر الثاني\nالسطر الثالث';
 await page.locator('textarea[name=caption]').fill(arabic);
 await expect(page.locator('textarea[name=caption]')).toHaveCSS('direction','rtl');
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), page.getByRole('button',{name:'Save changes'}).click()]);
 await page.reload();
 await expect(page.locator('textarea[name=caption]')).toHaveValue(arabic);
 await expect(page.locator('textarea[name=caption]')).toHaveCSS('direction','rtl');
 await page.locator('textarea[name=caption]').fill('');
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST' && response.url().includes('/work/board/')), page.getByRole('button',{name:'Save changes'}).click()]); // Leave the seeded card as the other tests expect it.
});

test('activity times hydrate without errors', async ({ browser }) => {
 // The server runs in UTC; the viewer is in Cairo (two hours ahead in November).
 const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', timezoneId: 'Africa/Cairo', locale: 'en-US' });
 const page = await context.newPage();
 const problems: string[] = [];
 page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
 page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
 await signIn(page, 'manager@example.com', '/c/rs-learning/home');
 for (const path of ['/c/rs-learning/home', '/c/rs-learning/work/board/1']) {
  await page.goto(path);
  const times = page.locator('time[datetime]');
  await expect(times.first()).toBeVisible();
  await expect(times.first()).toHaveCSS('visibility', 'visible');
  const locale = (await page.locator('html').getAttribute('lang')) === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US-u-nu-latn';
  for (const time of await times.all()) {
   const instant = await time.getAttribute('datetime');
   const expected = new Date(instant!).toLocaleDateString(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
   await expect(time).toHaveText(expected);
   const parts = Object.fromEntries(new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).formatToParts(new Date(instant!)).map(part => [part.type, part.value]));
   await expect(time).toContainText(`${parts.hour}:${parts.minute}`);
  }
 }
 expect(problems).toEqual([]);
 await context.close();
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
