import { test, expect, type Page, type Locator } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { mkdir } from 'node:fs/promises';
import { signIn, openNavigation, closeNavigation, openMoreSection } from './sign-in';
import { idle } from './navigation-measure';
import { sections } from '../lib/navigation';
import { i18n, type Language } from '../lib/i18n.mjs';

async function chooseLanguage(page:Page,language:Language) {
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption(language);
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang',language);
 await expect(page.locator('html')).toHaveAttribute('dir',language==='ar'?'rtl':'ltr');
}

test('390px language choice survives the previous save finishing',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/settings');
 await chooseLanguage(page,'ar');
 const select=page.locator('select[name=language]');
 const save=page.locator('form').filter({has:select}).getByRole('button');
 await expect(save).toBeEnabled();
 let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 let arrived!:()=>void;
 const responseReady=new Promise<void>(resolve=>{arrived=resolve;});
 await page.route('**/c/rs-learning/settings',async route=>{
  const response=await route.fetch();
  arrived();
  await held;
  await route.fulfill({response});
 },{times:1});
 await save.click();
 await responseReady;
 const selection=select.selectOption('en');
 try {
  // Either keep the new choice or defer editing until the pending save completes.
  await expect.poll(async()=>await select.isDisabled()||await select.inputValue()==='en').toBe(true);
 } finally {release();}
 await selection;
 await expect(save).toBeEnabled();
 await save.click();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(page.locator('html')).toHaveAttribute('dir','ltr');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(select).toHaveValue('en');
});
async function expectTitleAligned(title:Locator,container:Locator,edge:'left'|'right') {
 await expect(title).toBeVisible();
 await title.evaluate(()=>document.fonts.ready);
 const text=await title.evaluate(node=>{
  const range=document.createRange();
  range.selectNodeContents(node);
  const rect=range.getBoundingClientRect();
  return {left:rect.left,right:rect.right};
 });
 const inner=await container.evaluate(node=>{
  const rect=node.getBoundingClientRect();
  const style=getComputedStyle(node);
  return {
   left:rect.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft),
   right:rect.right-parseFloat(style.borderRightWidth)-parseFloat(style.paddingRight)
  };
 });
 expect(Math.abs(text[edge]-inner[edge])).toBeLessThanOrEqual(2);
}
async function expectNumberOrder(title:Locator,arabic=false) {
 const {positions,numberLeft,numberRight,wordsLeft}=await title.evaluate((node,arabic)=>{
  const text=node.firstChild!;
  const start=text.textContent!.indexOf('1440');
  const positions=Array.from({length:4},(_,i)=>{
   const range=document.createRange();
   range.setStart(text,start+i);
   range.setEnd(text,start+i+1);
   return range.getBoundingClientRect().left;
  });
  const number=document.createRange();
  number.setStart(text,start);
  number.setEnd(text,start+4);
  const words=document.createRange();
  words.setStart(text,0);
  words.setEnd(text,arabic?text.textContent!.indexOf(' 1440'):start);
  return {positions,numberLeft:number.getBoundingClientRect().left,numberRight:number.getBoundingClientRect().right,wordsLeft:words.getBoundingClientRect().left};
 },arabic);
 if(arabic) expect(numberRight).toBeLessThanOrEqual(wordsLeft);
 else expect(numberLeft).toBeGreaterThanOrEqual(wordsLeft);
 expect(positions).toEqual([...positions].sort((a,b)=>a-b));
 expect(new Set(positions).size).toBe(4);
}
async function signOut(page:Page) {
 const config=await (await page.request.get('/api/config')).json();
 const cookies=await page.context().cookies();
 const db=createServerClient(config.url,config.anonKey,{cookieOptions:config.cookieOptions,cookies:{getAll:()=>cookies,setAll:()=>{}}});
 const {error}=await db.auth.signOut();
 expect(error).toBeNull();
 await page.context().clearCookies();
 await page.goto('/sign-in');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
}

test('English default, account language across sessions/devices, automatic content direction and bilingual screenshots',async({page,browser},testInfo)=>{
 test.setTimeout(240000);
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(page.locator('html')).toHaveAttribute('dir','ltr');
 await expect(page.locator('.topbar')).toHaveText('Home');
 expect((await page.locator('.sidebar').boundingBox())!.x).toBe(0);
 const suffix=Date.now();
 const titles=[`بطاقة من الإعدادات 1440 ${suffix}`,`Settings card 1440 ${suffix}`];
 const calendarTitles=[`ع 1440 ${suffix.toString(36)}`,`A 1440 ${suffix.toString(36)}`];
 const goLive=`${new Date().toISOString().slice(0,10)}T12:00`;
 const paths:string[]=[];
 for(const title of [...titles,...calendarTitles]) {
  await page.goto('/c/rs-learning/work/new');
  await page.getByLabel('Message',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Create card',exact:true}).click();
  await expect(page.locator('.modal h2').first()).toHaveText(title);
  paths.push(new URL(page.url()).pathname);
  await page.locator('input[name=go_live]').fill(goLive);
  await Promise.all([
   page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname===paths.at(-1)),
   page.getByRole('button',{name:'Save changes',exact:true}).click()
  ]);
  await page.reload();
  await expect(page.locator('input[name=go_live]')).toHaveValue(goLive);
 }
 try {
  for(const language of ['en','ar'] as const) {
   await page.setViewportSize({width:1440,height:900});
   await chooseLanguage(page,language);
   const {t}=i18n(language);
   // Home has no sidebar entry; it opens from the account menu's "More sections" (#8).
   await openMoreSection(page,'home');
   await expect(page.locator('.topbar')).toHaveText(t('home'));
   for(const section of Object.keys(sections).filter(section=>section!=='work/new')) {
    await page.goto(`/c/rs-learning/${section}`);
    if(section.startsWith('settings/')) await expect(page.locator('.topbar [data-slot="breadcrumb"]')).toContainText(t(sections[section]));
    else await expect(page.locator('.topbar')).toHaveText(t(sections[section]));
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await expect(page.locator('.sidebar .sb-nav .sb-item').first()).toHaveText(t('chats'));
   }
   // Settings moved from the sidebar's bottom row into the account menu; it is still in the chosen language.
   await page.getByRole('button',{name:t('accountMenu'),exact:true}).click();
   // Anchored at the start: "More sections" (#8) also lists Work settings, whose name contains the word.
   await expect(page.getByRole('menu').getByRole('menuitem').filter({hasText:new RegExp(`^${t('settings')}`)})).toHaveAttribute('href','/c/rs-learning/settings');
   await page.keyboard.press('Escape');
   await expect(page.getByRole('menu')).toHaveCount(0);
   await page.goto('/c/rs-learning/work/board');
   for(const [index,title] of titles.entries()) {
    const link=page.locator('.card').getByRole('link',{name:title,exact:true});
    const titleNode=link.locator('strong');
    await expect(titleNode).toHaveCSS('direction',index===0?'rtl':'ltr');
    await expectTitleAligned(titleNode,link.locator('..'),index===0?'right':'left');
    await expectNumberOrder(titleNode,index===0);
    await page.goto(paths[index]);
    await expect(page.locator('.modal h2').first()).toHaveCSS('direction',index===0?'rtl':'ltr');
    await expectNumberOrder(page.locator('.modal h2').first(),index===0);
    await expect(page.locator('.recent-cards').getByRole('link',{name:title,exact:true}).locator('.recent-title')).toHaveCSS('direction',index===0?'rtl':'ltr');
    await page.goto('/c/rs-learning/work/board');
   }
   await page.goto('/c/rs-learning/work/calendar');
   for(const [index,title] of [...calendarTitles,...titles].entries()) {
    const link=page.locator('.calendar').getByRole('link',{name:title,exact:true});
    await expect(link).toHaveCSS('direction',index%2===0?'rtl':'ltr');
    // Preserve origin/main's 5px desktop inline padding on both sides.
    await expect(link).toHaveCSS('padding-inline-start','5px');
    await expect(link).toHaveCSS('padding-inline-end','5px');
    const chip=await link.evaluate(node=>{
     const rect=node.getBoundingClientRect();
     const day=node.parentElement!;
     const cell=day.getBoundingClientRect();
     const style=getComputedStyle(day);
     const left=cell.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
     const right=cell.right-parseFloat(style.borderRightWidth)-parseFloat(style.paddingRight);
     const edge=getComputedStyle(node).direction==='rtl'?'right':'left';
     return {distance:Math.abs(rect[edge]-(edge==='right'?right:left)),width:rect.width,available:right-left,overflow:node.scrollWidth-node.clientWidth};
    });
    expect(chip.distance).toBeLessThanOrEqual(2);
    expect(chip.width).toBeLessThanOrEqual(chip.available);
    expect(chip.overflow).toBe(0);
    if(index<calendarTitles.length) expect(chip.width).toBeLessThan(chip.available);
   }
   await page.goto('/c/rs-learning/home');
   for(const [index,title] of titles.entries()) {
    const recent=page.locator('.home-recent').getByRole('link',{name:title,exact:true});
    await expectTitleAligned(recent,recent.locator('..'),index===0?'right':'left');
    await expectNumberOrder(recent,index===0);
   }
   const screenshotDir='test-results/screenshots/languages';
   await mkdir(screenshotDir,{recursive:true});
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const section of ['home','work/board']) {
     await page.goto(`/c/rs-learning/${section}`);
     await idle(page);
     await openNavigation(page);
     const sidebar=(await page.locator('.sidebar').boundingBox())!;
     expect(language==='en'?sidebar.x:sidebar.x+sidebar.width).toBe(language==='en'?0:width);
     await closeNavigation(page);
     if(section==='work/board') {
      const columns=page.locator('.column');
      const first=(await columns.nth(0).boundingBox())!,second=(await columns.nth(1).boundingBox())!;
      expect(language==='ar'?first.x>second.x:first.x<second.x).toBe(true);
     }
     expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
     const path=`${screenshotDir}/${section==='home'?'home':'board'}-${language}-${width===1440?'desktop':'mobile'}.png`;
     await page.screenshot({path,fullPage:true});
     await testInfo.attach(path.split('/').pop()!,{path,contentType:'image/png'});
    }
   }
  }
  await signOut(page);
  await signIn(page,'manager@example.com','/c/rs-learning/home');
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('.topbar')).toHaveText('الرئيسية');
  const second=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:900}});
  try {
   const other=await second.newPage();
   await signIn(other,'manager@example.com','/c/rs-learning/home');
   await expect(other.locator('html')).toHaveAttribute('lang','ar');
   await expect(other.locator('html')).toHaveAttribute('dir','rtl');
   await expect(other.locator('.topbar')).toHaveText('الرئيسية');
   expect((await other.locator('.sidebar').boundingBox())!.x).toBe(1440-300);
   await other.goto('/no-company');
   await expect(other.getByRole('heading',{level:1})).toHaveText('لا توجد شركة بعد');
  } finally {await second.close();}
 } finally {await chooseLanguage(page,'en');}
});

test('anonymous sign-in defaults to English and can render Arabic including its confirmation message',async({page})=>{
 await page.goto('/sign-in');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.getByLabel('Interface language').selectOption('ar');
 const {t}=i18n('ar');
 await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 await expect(page.getByRole('heading',{level:1})).toHaveText(t('signIn'));
 await expect(page.getByLabel(t('password'),{exact:true})).toBeVisible();
 // The confirmation the sign-in screens give is the reset-link one (#41); the chosen language carries over to that page.
 await page.getByRole('link',{name:t('forgotPassword')}).click();
 await expect(page).toHaveURL(/\/forgot-password\?language=ar$/);
 await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 await page.getByLabel(t('email'),{exact:true}).fill('viewer@example.com');
 await page.getByRole('button',{name:t('sendResetLink')}).click();
 await expect(page.getByRole('status')).toHaveText(t('checkYourEmailForAResetLink'));
});
