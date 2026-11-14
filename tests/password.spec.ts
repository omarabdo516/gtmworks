import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signIn, emailLink, seededPassword } from './sign-in';

// Signing in with an email and a password (#41). Passwords go only to the auth service (GoTrue).
const inbox='http://127.0.0.1:54324/api/v1/messages';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const sessionCookies=async(context:BrowserContext)=>(await context.cookies()).filter(cookie=>/^sb-.*-auth-token/.test(cookie.name));
// Fill and send the sign-in form; returns the auth service's answer, which the browser asks for itself.
async function attempt(page:Page,email:string,password:string) {
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/auth/v1/token'));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return response;
}
const alertWith=(page:Page,text:string)=>page.getByRole('alert').filter({hasText:text});
// The current six-digit code for an authenticator secret (RFC 6238, SHA-1, 30 seconds).
function totp(secret:string) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=''; for(const c of secret.replace(/=+$/,'').toUpperCase()) bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g)?.map(b=>parseInt(b,2)) || []); const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000))); const hash=createHmac('sha1',key).update(counter).digest(); const offset=hash[19]&15; return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}

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

// A password sign-in, or a reset link, opens a first-level (aal1) session. With a verified authenticator the auth service
// itself refuses a password change from it, whatever a client sends; the set-password page asks for the code first.
test('with a verified authenticator the password changes only after the second step in that session',async({page,context})=>{
 const value=status();
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),options);
 const email=`aal2-${Date.now()}@example.com`;
 const {data:{user},error:created}=await service.auth.admin.createUser({email,password:'old-password-41',email_confirm:true});
 expect(created).toBeNull();
 query(`insert into public.people(id,name) values ('${user!.id}','Two-step person')`);
 // The person sets up an authenticator and verifies it once.
 const setUp=createClient(value('API_URL'),value('ANON_KEY'),options);
 expect((await setUp.auth.signInWithPassword({email,password:'old-password-41'})).error).toBeNull();
 const {data:factor,error:enrolled}=await setUp.auth.mfa.enroll({factorType:'totp',friendlyName:'Authenticator'});
 expect(enrolled).toBeNull();
 const window=Math.floor(Date.now()/30000);
 expect((await setUp.auth.mfa.challengeAndVerify({factorId:factor!.id,code:totp(factor!.totp.secret)})).error).toBeNull();

 // A new password sign-in is aal1; a direct password change from it is refused by the auth service and changes nothing.
 const direct=createClient(value('API_URL'),value('ANON_KEY'),options);
 expect((await direct.auth.signInWithPassword({email,password:'old-password-41'})).error).toBeNull();
 const {data:level}=await direct.auth.mfa.getAuthenticatorAssuranceLevel();
 expect([level?.currentLevel,level?.nextLevel]).toEqual(['aal1','aal2']);
 const refused=await direct.auth.updateUser({password:'changed-at-aal1'});
 expect(refused.error?.code).toBe('insufficient_aal');
 expect((await direct.auth.signInWithPassword({email,password:'changed-at-aal1'})).error?.code).toBe('invalid_credentials');

 // The reset link opens an aal1 session too: the page asks for the code, refuses a wrong one, and saves after the right one.
 await page.request.delete(inbox);
 await page.goto('/forgot-password?language=en');
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByRole('button',{name:'Send reset link'}).click();
 await expect(page.getByRole('status')).toHaveText('If an account uses this email, a link to set a new password is on its way.');
 const link=await emailLink(page,email);
 await context.clearCookies();
 await page.goto(link);
 await expect(page).toHaveURL(/\/reset-password$/);
 await page.getByLabel('New password').fill('new-password-aal2');
 await page.getByLabel('Confirm password').fill('new-password-aal2');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(alertWith(page,'Your account uses two-step verification: enter the code from your authenticator app to change your password.')).toBeVisible();
 expect((await direct.auth.signInWithPassword({email,password:'new-password-aal2'})).error?.code).toBe('invalid_credentials');
 await page.getByLabel('Verification code').fill(totp(factor!.totp.secret)==='000000'?'111111':'000000');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(alertWith(page,'Incorrect code. Try again.')).toBeVisible();
 expect((await direct.auth.signInWithPassword({email,password:'new-password-aal2'})).error?.code).toBe('invalid_credentials');
 // A code is used once: wait for the next one after the code that verified the authenticator.
 if(Math.floor(Date.now()/30000)===window) await page.waitForTimeout(30000-Date.now()%30000+500);
 await page.getByLabel('Verification code').fill(totp(factor!.totp.secret));
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/no-company$/);
 await context.clearCookies();
 await signIn(page,email,'/sign-in','new-password-aal2');
 await expect(page).toHaveURL(/\/no-company$/);
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
  // The password is changed in the settings overlay's Your account (#26).
  await signIn(page,'viewer@example.com','/c/rs-learning/home');
  await page.goto('/c/rs-learning/settings?section=account');
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
