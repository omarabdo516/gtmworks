import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { signIn } from './sign-in';

// A person never reads the Engine's name (#286), in either language: not in the interface, and not in the seed's
// agents shown in the sidebar. Aleem gets a connected profile below; RS Learning is walked as the seed and the earlier
// tests leave it.
const company='10000000-0000-0000-0000-000000000003';
const owner='20000000-0000-0000-0000-000000000001';
const pages=['/all-brands','/c/aleem/home','/c/aleem/agents','/c/aleem/settings/agents','/c/aleem/usage','/c/rs-learning/agents','/c/rs-learning/settings/agents'];
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
function totp(secret:string) {
 const bits=[...secret.toUpperCase()].map(character=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from(bits.match(/.{8}/g)!.map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest();
 return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
// Everything a person can read or hear: the title, the visible text, and labels, placeholders and tooltips.
const readable=(page:Page)=>page.evaluate(()=>[document.title,document.body.innerText,
 ...[...document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')].flatMap(element=>['aria-label','placeholder','title','alt'].map(name=>element.getAttribute(name)||''))].join('\n'));

test('page titles, the sidebar, Agent pages and connection screens never name the Engine, in English or Arabic',async({page})=>{
 const connection=randomUUID(), agent=randomUUID();
 // A connected profile with a main agent, so the connection status, version and agent rows are on screen too.
 query(`insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state,version,unreachable_since) values ('${connection}','${company}','${owner}','http://localhost','engine-name','ciphertext','unreachable','0.23.0',now())`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${agent}','${company}','${connection}','Lead','General',true)`);
 try {
  query(`delete from auth.mfa_factors where user_id='${owner}'`);
  query(`update public.people set language='en' where id='${owner}'`);
  await signIn(page,'omar@example.com','/all-brands');
  await page.getByRole('button',{name:'Set up authenticator'}).click();
  await page.getByLabel('Verification code').fill(totp((await page.locator('code').textContent())!));
  await page.getByRole('button',{name:'Verify',exact:true}).click();
  await expect(page.locator('.company-card')).toHaveCount(3);
  for(const language of ['en','ar'] as const) {
   query(`update public.people set language='${language}' where id='${owner}'`);
   for(const path of pages) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    if(path==='/c/aleem/settings/agents') await expect(page.getByText('0.23.0')).toBeVisible();
    if(path==='/c/aleem/agents') await expect(page.locator('.company-hermes-agents').getByText('Lead',{exact:true})).toBeVisible();
    const text=await readable(page);
    expect(text.length,`${language} ${path}`).toBeGreaterThan(0);
    expect(text,`${language} ${path}`).not.toMatch(/hermes|هيرمس|هرمس/i);
   }
  }
 } finally {
  query(`update public.people set language='en' where id='${owner}'`);
  query(`delete from public.hermes_agents where id='${agent}'`);
  query(`delete from public.hermes_connections where id='${connection}'`);
 }
});
