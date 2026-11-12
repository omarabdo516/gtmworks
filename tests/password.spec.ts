import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { signIn, emailLink, seededPassword } from './sign-in';

// Signing in with an email and a password (#41). Passwords go only to the auth service (GoTrue).
const inbox='http://127.0.0.1:54324/api/v1/messages';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const sessionCookies=async(context:BrowserContext)=>(await context.cookies()).filter(cookie=>/^sb-.*-auth-token/.test(cookie.name));
// Fill and send the sign-in form; returns the server action's response.
async function attempt(page:Page,email:string,password:string) {
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/sign-in');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return response;
}
const alertWith=(page:Page,text:string)=>page.getByRole('alert').filter({hasText:text});

test('the right email and password reach the Company home; a wrong password and an unknown email get the same answer and no session',async({page,context})=>{
 await page.goto('/sign-in');
 const wrong=await attempt(page,'manager@example.com','not-the-password');
 await expect(alertWith(page,'Wrong email or password.')).toBeVisible();
 const wrongText=await alertWith(page,'Wrong email or password.').textContent();
 expect(await sessionCookies(context)).toEqual([]);
 await page.goto('/sign-in');
 const unknown=await attempt(page,'nobody-here@example.com','not-the-password');
 await expect(alertWith(page,'Wrong email or password.')).toBeVisible();
 expect(await alertWith(page,'Wrong email or password.').textContent()).toBe(wrongText);
 expect(unknown.status()).toBe(wrong.status());
 expect(await sessionCookies(context)).toEqual([]);
 await expect(page).toHaveURL(/\/sign-in/);
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 await expect(page.locator('.home-dashboard')).toBeVisible();
 expect((await sessionCookies(context)).length).toBeGreaterThan(0);
});

test('Forgot password emails a link that opens only the set-password page, works once, and the new password signs in',async({page,context})=>{
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`reset-${Date.now()}@example.com`;
 const {data:{user},error:created}=await service.auth.admin.createUser({email,password:'old-password-41',email_confirm:true});
 expect(created).toBeNull();
 // Every account gtmworks makes has its person (first run, invitations); a signed-in page reads its language there.
 query(`insert into public.people(id,name) values ('${user!.id}','Reset person')`);
 await page.request.delete(inbox);
 await page.goto('/sign-in');
 await page.getByRole('link',{name:'Forgot password?'}).click();
 await expect(page).toHaveURL(/\/forgot-password\?language=en$/);
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByRole('button',{name:'Send reset link'}).click();
 await expect(page.getByRole('status')).toHaveText('If an account uses this email, a link to set a new password is on its way.');
 const link=await emailLink(page,email);
 // The link works without anything the asking browser kept: it may be opened on another device.
 await context.clearCookies();
 await page.goto(link);
 await expect(page).toHaveURL(/\/reset-password$/);
 await expect(page.getByRole('heading',{name:'Set a new password'})).toBeVisible();
 await page.getByLabel('New password').fill('too-short');
 await page.getByLabel('Confirm password').fill('too-short');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(alertWith(page,'Use at least 10 characters for your password.')).toBeVisible();
 await page.getByLabel('New password').fill('new-password-41');
 await page.getByLabel('Confirm password').fill('new-password-41');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/no-company$/);
 await context.clearCookies();
 await signIn(page,email,'/sign-in','new-password-41');
 await expect(page).toHaveURL(/\/no-company$/);
 // The same link a second time is refused and does not open the set-password page.
 await context.clearCookies();
 await page.goto(link);
 await expect(page).toHaveURL(/\/forgot-password\?link=invalid$/);
 await expect(alertWith(page,'This link is invalid, expired or already used. Ask for a new one.')).toBeVisible();
 await expect(page.getByLabel('New password')).toHaveCount(0);
 expect(await sessionCookies(context)).toEqual([]);
});

test('an invited Member sets a password from the invitation and signs in with it later',async({page,context})=>{
 const email=`password-invited-${Date.now()}@example.com`;
 await signIn(page,'manager@example.com','/c/rs-learning/settings/members');
 await page.request.delete(inbox);
 await page.getByLabel('Email').fill(email);
 await page.getByRole('button',{name:'Send invitation'}).click();
 await expect(page.getByRole('status')).toContainText('An invitation link was sent');
 const link=await emailLink(page,email);
 await context.clearCookies();
 await page.goto(link);
 await expect(page.getByRole('heading',{name:'Set a new password'})).toBeVisible();
 await page.getByLabel('New password').fill('invited-password-41');
 await page.getByLabel('Confirm password').fill('invited-password-41');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\/members/);
 await context.clearCookies();
 await signIn(page,email,'/c/rs-learning/home','invited-password-41');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
});

test('a signed-in person changes their own password in settings and signs in with the new one',async({page,context})=>{
 try {
  await signIn(page,'viewer@example.com','/c/rs-learning/settings');
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Change password'})});
  await panel.getByLabel('New password').fill('viewer-new-password');
  await panel.getByLabel('Confirm password').fill('viewer-other-password');
  await panel.getByRole('button',{name:'Save password'}).click();
  await expect(alertWith(page,'The two passwords do not match.')).toBeVisible();
  await panel.getByLabel('Confirm password').fill('viewer-new-password');
  await panel.getByRole('button',{name:'Save password'}).click();
  await expect(panel.getByRole('status')).toHaveText('Password saved.');
  await context.clearCookies();
  await signIn(page,'viewer@example.com','/c/rs-learning/home','viewer-new-password');
  await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
 } finally {
  // Later tests sign in with the seeded password.
  query(`update auth.users set encrypted_password=extensions.crypt('${seededPassword}',extensions.gen_salt('bf')) where email='viewer@example.com'`);
 }
});

// Runs last in this file: it spends the address's sign-in allowance on purpose. tests/sign-in.ts waits for it to refill.
test('integration: repeated wrong passwords hit the auth service\'s own rate limit and the page says to try again later',async({page,context})=>{
 test.setTimeout(240000);
 const config=readFileSync('supabase/config.toml','utf8');
 const limit=(name:string)=>Number(config.match(new RegExp(`^${name} = (\\d+)$`,'m'))![1]);
 const configured=limit('sign_in_sign_ups');
 expect(configured).toBeGreaterThan(0);
 const value=status();
 // Wrong passwords straight to the auth service until it answers 429; never more than twice the larger of the two limits
 // that can cover this endpoint, so a missing limit fails instead of hanging.
 async function exhaust() {
  for(let sent=0,max=2*Math.max(configured,limit('token_refresh'))+10; sent<max; sent++) {
   const response=await page.request.post(`${value('API_URL')}/auth/v1/token?grant_type=password`,{headers:{apikey:value('ANON_KEY')},data:{email:'manager@example.com',password:`wrong-password-${sent}`}});
   if(response.status()===429) return {sent,body:await response.json() as {error_code?:string}};
   expect(response.status()).toBe(400);
  }
  return null;
 }
 const limited=await exhaust();
 expect(limited,'the auth service never answered 429').not.toBeNull();
 expect(limited!.body.error_code).toBe('over_request_rate_limit');
 // The allowance refills slowly, so one page attempt may still get through as an ordinary wrong password: drain it again
 // and retry. The page shows the limit as its own message, not as a wrong password, and opens no session.
 await page.goto('/sign-in');
 await expect(async()=>{
  expect(await exhaust()).not.toBeNull();
  await attempt(page,'manager@example.com','still-the-wrong-password');
  await expect(alertWith(page,'Too many sign-in attempts. Try again later.')).toBeVisible({timeout:3000});
 }).toPass({timeout:180000});
 await expect(page).toHaveURL(/\/sign-in/);
 expect(await sessionCookies(context)).toEqual([]);
});
