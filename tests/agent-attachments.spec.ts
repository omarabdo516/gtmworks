import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
// A real 1 x 1 PNG: the page must show it.
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64');
const picture=(name:string)=>({name,mimeType:'image/png',buffer:bytes});
const attach=(page:Page)=>page.locator('input[type=file][name=files]');
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
// The thumbnail of the message holding `text`: it must really load, and its address names the file by id, never by storage path.
async function thumbnail(page:Page,text:string) {
 const image=page.locator('.conversation .message').filter({hasText:text}).locator('.attachments img');
 await expect(image).toHaveCount(1);
 await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 const source=await image.getAttribute('src');
 expect(source).toMatch(/^\/c\/[a-z-]+\/files\/\d+$/);
 return source as string;
}
async function reply(page:Page,text:string) {
 await page.getByLabel('Comment',{exact:true}).fill(text);
 await attach(page).setInputFiles(picture('reply.png'));
 await page.getByRole('button',{name:'Send',exact:true}).click();
 return thumbnail(page,text);
}

test('a file attached in the composer and in a reply shows as a thumbnail, in both languages',async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 const stamp=Date.now();
 await signIn(page,'omar@example.com','/c/rs-learning/work/new');
 try {
  // The composer in both languages and at phone and desktop width, kept as screenshots of the run.
  for(const language of ['en','ar'] as const) {
   await chooseLanguage(page,language);
   await page.goto('/c/rs-learning/work/new');
   await page.getByLabel(language==='en'?'Message':'الرسالة',{exact:true}).fill(`Reference image ${stamp}`);
   await attach(page).setInputFiles(picture('reference.png'));
   for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/attachments-composer-${language}-${width}.png`}); }
  }
  await page.setViewportSize({width:1280,height:720});
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/work/new');
  await page.getByLabel('Message',{exact:true}).fill(`Reference image ${stamp}`);
  await attach(page).setInputFiles(picture('reference.png'));
  await page.getByRole('button',{name:'Create card',exact:true}).click();
  await expect(page).toHaveURL(/\/work\/board\/\d+$/);
  const cardPath=new URL(page.url()).pathname;
  const first=await thumbnail(page,`Reference image ${stamp}`);
  // The reply comes below it, with its own file.
  const second=await reply(page,`Here is another one ${stamp}`);
  expect(second).not.toBe(first);
  await expect(page.locator('.conversation .message')).toHaveCount(2);
  // A member opens the file by its address and gets the picture itself, shown in place and sandboxed.
  const opened=await page.request.get(first);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('image/png');
  expect(opened.headers()['content-security-policy']).toContain('sandbox');
  expect(await opened.body()).toEqual(bytes);
  for(const language of ['en','ar'] as const) {
   await chooseLanguage(page,language);
   await page.goto(cardPath);
   await expect(page.locator('.conversation .message .attachments img')).toHaveCount(2);
   for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.locator('.modal').first().screenshot({path:`test-results/screenshots/attachments-card-${language}-${width}.png`}); }
  }
 } finally { await chooseLanguage(page,'en'); }
});
