import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { updateHostOf } from './lane.mjs';
import { signIn } from './sign-in';
import { whatsNew } from '../lib/updates.mjs';

// #442: a lane's app is gtmworks 0.0.1 and reads the newest release from its lane's address (scripts/web.sh). This
// spec starts a fake release source there with a newer release that brings one entry: the Owner sees Update ready with
// it and the command, hides it, and it stays hidden; a Manager sees nothing.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const arrived={issue:999999,date:'2026-11-21',en:{title:'Faster boards',body:'The board opens at once, however many cards it holds.'},ar:{title:'بوردات أسرع',body:'البورد بيفتح على طول، مهما كان فيه كروت.'}};
const fakeSource=()=>new Promise<Server>(resolve=>{
 const server=createServer((request,response)=>{
  const body=request.url==='/releases?per_page=100'?[{tag_name:'v9.9.9',published_at:new Date(Date.now()-2*86400000).toISOString()}]
   :request.url==='/v9.9.9/lib/whats-new.json'?[arrived,...whatsNew]:null;
  response.writeHead(body?200:404,{'content-type':'application/json'}).end(JSON.stringify(body));
 });
 server.listen(8643,updateHostOf(),()=>resolve(server));
});

test('an Owner on an older version sees Update ready with what it brings and the command, and can hide it until the next one; a Manager sees nothing',async({page})=>{
 query(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')`);
 const source=await fakeSource();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const item=page.getByRole('button',{name:'Update ready',exact:true});
  await item.click();
  const dialog=page.getByRole('dialog',{name:'Update ready'});
  await expect(dialog).toContainText('gtmworks v9.9.9 came out 2 days ago.');
  await expect(dialog).toContainText('Faster boards The board opens at once, however many cards it holds.');
  await expect(dialog.locator('code')).toHaveText('gtmworks update');
  await expect(dialog.getByRole('button',{name:'Copy the command gtmworks update'})).toBeVisible();
  await dialog.getByRole('button',{name:'Hide until the next version'}).click();
  await expect(item).toHaveCount(0);
  // Opened again, the check answers the same version, and it stays hidden.
  const checked=page.waitForResponse(response=>response.url().includes('/api/update?'));
  await page.reload();
  expect((await (await checked).json()).update.version).toBe('v9.9.9');
  await expect(page.locator('#btn-apps')).toBeVisible();
  await expect(item).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page,'manager@example.com','/c/rs-learning/home');
  await expect(page.locator('#btn-apps')).toBeVisible();
  await expect(page.getByRole('button',{name:'Update ready',exact:true})).toHaveCount(0);
 } finally { await new Promise(resolve=>source.close(resolve)); }
});
