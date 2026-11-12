import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
// This file sorts before app.spec.ts on purpose: that file revokes the public fixture key at its end.
const agent={Authorization:'Bearer agt_local_fixture_for_tests_only'};
const root='/api/v1/companies/rs-learning/cards';
const bearer=(key:string)=>({Authorization:`Bearer ${key}`});
// A real 1 x 1 PNG: the page must show it, and the API must return exactly these bytes.
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64');
const picture=(name:string)=>({name,mimeType:'image/png',buffer:bytes});
const attach=(page:Page)=>page.locator('input[type=file][name=files]');
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption(language);
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
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

test('a run key downloads the files of its own card and no other, and another company finds nothing',async({page,request,browser})=>{
 const stamp=Date.now();
 // The seeded cards 1 and 2 are RS Learning's: the agent holds the first of them (as in agent-run-keys.spec.ts), the other is a card it must not reach.
 const ids:number[]=(await (await request.get(`${root}?next_actor=me`,{headers:agent})).json()).cards.map((card:{id:number})=>card.id);
 expect(ids.length).toBeGreaterThan(0);
 const own=ids[0]; const other=own===1?2:1;
 await signIn(page,'omar@example.com',`/c/rs-learning/work/board/${own}`);
 const ownFile=Number((await reply(page,`File on the own card ${stamp}`)).split('/').pop());
 await page.goto(`/c/rs-learning/work/board/${other}`);
 const otherFile=Number((await reply(page,`File on the other card ${stamp}`)).split('/').pop());

 const issued=await request.post(`${root}/${own}/run-keys`,{headers:agent,data:{}});
 expect(issued.status()).toBe(201);
 const run=bearer((await issued.json()).key);
 const download=await request.get(`${root}/${own}/files/${ownFile}`,{headers:run});
 expect(download.status()).toBe(200);
 expect(download.headers()['content-type']).toBe('image/png');
 expect(await download.body()).toEqual(bytes);
 // Its own card lists the file; another card is forbidden, and a file of another card asked for through its own card is not found.
 const listed=await request.get(`${root}?next_actor=me`,{headers:run});
 expect((await listed.json()).cards[0].attachments).toEqual(expect.arrayContaining([expect.objectContaining({id:ownFile,name:'reply.png',content_type:'image/png'})]));
 expect((await request.get(`${root}/${other}/files/${otherFile}`,{headers:run})).status()).toBe(403);
 expect((await request.get(`${root}/${own}/files/${otherFile}`,{headers:run})).status()).toBe(404);
 expect((await request.get(`${root}/${own}/files/999999`,{headers:run})).status()).toBe(404);
 // The company key reaches every card of its company.
 expect((await request.get(`${root}/${other}/files/${otherFile}`,{headers:agent})).status()).toBe(200);

 // Another company: a file of Aleem's is found by Aleem's members only.
 // Aleem has no agent granted yet, so its card comes from the board's stage form.
 await page.goto('/c/aleem/work/board');
 await page.getByRole('button',{name:'+ Add card'}).first().click();
 await page.getByLabel('Card title').fill(`Aleem files ${stamp}`);
 await page.getByRole('button',{name:'Create card',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/aleem\/work\/board\/\d+$/);
 const aleemCard=Number(new URL(page.url()).pathname.split('/').pop());
 const aleemFile=await reply(page,`File in Aleem ${stamp}`);
 expect((await page.request.get(aleemFile)).status()).toBe(200);
 const outside=await browser.newContext({baseURL:'http://127.0.0.1:3000'});
 try {
  const outsider=await outside.newPage();
  await signIn(outsider,'reviewer@example.com','/c/rs-learning/home'); // A member of RS Learning only.
  expect((await outsider.request.get(aleemFile)).status()).toBe(404);
  expect((await outsider.request.get(aleemFile.replace('/c/aleem/','/c/rs-learning/'))).status()).toBe(404);
  expect((await outsider.request.get(`/c/rs-learning/files/${ownFile}`)).status()).toBe(200);
 } finally { await outside.close(); }
 expect((await request.get(aleemFile,{maxRedirects:0})).status()).not.toBe(200); // Signed out: a redirect to sign-in or not found, never the file.
 // RS Learning's agent key is not Aleem's.
 expect((await request.get(`/api/v1/companies/aleem/cards/${aleemCard}/files/${aleemFile.split('/').pop()}`,{headers:agent})).status()).toBe(404);
});
