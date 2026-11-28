import { test, expect, type Page, type BrowserContext } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signIn, emailLink, seededPassword } from './sign-in';
import { inbox } from './lane.mjs';
import { totp } from './totp';

// Signing in with an email and a password (#41). Passwords go only to the auth service (GoTrue).
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

// A password sign-in opens a first-level (aal1) session. With a verified authenticator the auth service itself refuses a
// password change from it, whatever a client sends; the set-password form asks for the code first.
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

 // Signed in with a password in the browser too, the Settings form asks for the code, refuses a wrong one, and saves
 // after the right one.
 query(`insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','${user!.id}','viewer')`);
 await context.clearCookies();
 await signIn(page,email,'/c/rs-learning/settings?section=account','old-password-41');
 const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Change password'})});
 await panel.getByLabel('New password').fill('new-password-aal2');
 await panel.getByLabel('Confirm password').fill('new-password-aal2');
 await panel.getByRole('button',{name:'Save password'}).click();
 await expect(alertWith(page,'Your account uses two-step verification: enter the code from your authenticator app to change your password.')).toBeVisible();
 expect((await direct.auth.signInWithPassword({email,password:'new-password-aal2'})).error?.code).toBe('invalid_credentials');
 await panel.getByLabel('Verification code').fill(totp(factor!.totp.secret)==='000000'?'111111':'000000');
 await panel.getByRole('button',{name:'Save password'}).click();
 await expect(alertWith(page,'Incorrect code. Try again.')).toBeVisible();
 expect((await direct.auth.signInWithPassword({email,password:'new-password-aal2'})).error?.code).toBe('invalid_credentials');
 // A code is used once: wait for the next one after the code that verified the authenticator.
 if(Math.floor(Date.now()/30000)===window) await page.waitForTimeout(30000-Date.now()%30000+500);
 await panel.getByLabel('Verification code').fill(totp(factor!.totp.secret));
 await panel.getByRole('button',{name:'Save password'}).click();
 await expect(panel.getByRole('status')).toHaveText('Password saved.');
 expect((await direct.auth.signInWithPassword({email,password:'new-password-aal2'})).error).toBeNull();
});

test('an invited Member sets a password from the invitation and signs in with it later',async({page,context})=>{
 const email=`password-invited-${Date.now()}@example.com`;
 // Only the Owner invites (#775).
 await signIn(page,'omar@example.com','/c/rs-learning/settings/members');
 await page.request.delete(inbox);
 await page.getByRole('button',{name:'Invite a member'}).click();
 await page.getByLabel('Member’s email').fill(email);
 await page.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(page.getByText(`Invite sent to ${email}`)).toBeVisible();
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
