import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { passwordProblem, passwordNeedsSecondStep, PASSWORD_MIN_LENGTH } from '../lib/password.mjs';
import { firstRunInput } from '../lib/first-run-input.mjs';

const en=JSON.parse(readFileSync('lib/messages/en.json','utf8'));
const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));

test('a password needs at least 10 characters and a matching confirmation', () => {
 assert.equal(PASSWORD_MIN_LENGTH,10);
 assert.equal(passwordProblem('','') ,'passwordTooShort');
 assert.equal(passwordProblem('a'.repeat(9),'a'.repeat(9)),'passwordTooShort');
 assert.equal(passwordProblem('a'.repeat(10),'a'.repeat(10)),null);
 // Characters, not bytes or UTF-16 units: nine Arabic letters are too short, ten are enough.
 assert.equal(passwordProblem('كلمةسرقصي','كلمةسرقصي'),'passwordTooShort');
 assert.equal(passwordProblem('كلمةسرقصير','كلمةسرقصير'),null);
 assert.equal(passwordProblem('🔑'.repeat(9),'🔑'.repeat(9)),'passwordTooShort');
 assert.equal(passwordProblem('a'.repeat(10),'b'.repeat(10)),'passwordsDoNotMatch');
 // Without a confirmation field (sign-in), only the length counts.
 assert.equal(passwordProblem('a'.repeat(10)),null);
});

test('the short-password message names the rule in English and Arabic', () => {
 assert.equal(en.passwordTooShort,'Use at least 10 characters for your password.');
 assert.equal(ar.passwordTooShort,'استخدم 10 أحرف على الأقل لكلمة المرور.');
 for(const key of ['passwordsDoNotMatch','wrongEmailOrPassword','tooManySignInAttempts','forgotPassword','setNewPassword','passwordSaved','resetLinkInvalid','checkYourEmailForAResetLink']) {
  assert.ok(en[key]?.trim(),`en has ${key}`);
  assert.ok(ar[key]?.trim(),`ar has ${key}`);
 }
});

test('first run takes a password with its confirmation and refuses a short or mismatched one', () => {
 const form=values=>{ const data=new FormData(); for(const [key,value] of Object.entries(values)) data.set(key,value); return data; };
 const base={name:'Owner',email:'owner@example.com',company:'Company',language:'en',password:'long-enough-1',confirm:'long-enough-1'};
 assert.deepEqual(firstRunInput(form(base)),{name:'Owner',email:'owner@example.com',company:'Company',language:'en',password:'long-enough-1'});
 // The password is kept exactly as typed: spaces are characters too.
 assert.equal(firstRunInput(form({...base,password:' spaced pw ',confirm:' spaced pw '}))?.password,' spaced pw ');
 assert.equal(firstRunInput(form({...base,password:'short',confirm:'short'})),null);
 assert.equal(firstRunInput(form({...base,confirm:'something-else'})),null);
 assert.equal(firstRunInput(form({...base,password:undefined,confirm:undefined})),null);
});

test('the auth service enforces the same rule, a 24 hour email link and a 30 day session', () => {
 const config=readFileSync('supabase/config.toml','utf8');
 assert.match(config,/^minimum_password_length = 10$/m);
 assert.match(config,/^otp_expiry = 86400$/m);
 const sessions=config.split(/^\[auth\.sessions\][ \t]*$/m)[1]?.split(/^\[/m)[0];
 assert.ok(sessions,'the sessions section is enabled');
 assert.match(sessions,/^timebox = "720h"$/m);
 const install=readFileSync('docker-compose.install.yml','utf8');
 assert.match(install,/^\s+GOTRUE_PASSWORD_MIN_LENGTH: "10"$/m);
 assert.match(install,/^\s+GOTRUE_MAILER_OTP_EXP: "86400"$/m);
 assert.match(install,/^\s+GOTRUE_SESSIONS_TIMEBOX: 720h$/m);
});

test('the README install section describes the password first run and what the local inbox is for', () => {
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 const install=readme.split('## Install')[1].split('## Update')[0];
 assert.ok(install.includes('On a fresh install, enter your name, email, a password of at least 10 characters (twice) and your first company name; you are signed in at once, with no email step.'));
 assert.ok(install.includes('The local inbox at http://localhost:8025 receives password reset links and invitations.'));
 assert.doesNotMatch(install,/follow the sign-in link/);
});

// A person with a verified authenticator signs in with a password at the first level (aal1); the auth service refuses
// to change their password until this session has passed the second step too (aal2), and so does the form.
test('a person with a verified second step passes it in this session before a password change', () => {
 assert.equal(passwordNeedsSecondStep({currentLevel:'aal1',nextLevel:'aal2'}),true);
 assert.equal(passwordNeedsSecondStep({currentLevel:'aal2',nextLevel:'aal2'}),false);
 assert.equal(passwordNeedsSecondStep({currentLevel:'aal1',nextLevel:'aal1'}),false);
 // Unknown levels leave the decision to the auth service, which refuses an aal1 password change on its own.
 assert.equal(passwordNeedsSecondStep(null),false);
});

test('the set-password form verifies the code before it sends the password, and shows the auth service refusal', () => {
 const form=readFileSync('app/set-password-form.tsx','utf8');
 const at=text=>{ const index=form.indexOf(text); assert.notEqual(index,-1,text); return index; };
 assert.ok(at('getAuthenticatorAssuranceLevel()')<at('mfa.challenge(')&&at('mfa.challenge(')<at('mfa.verify(')&&at('mfa.verify(')<at('updateUser('),'level, challenge, verify, then the password');
 assert.match(form,/passwordNeedsSecondStep\(/);
 assert.match(form,/'insufficient_aal'/);
 assert.match(form,/t\('verificationCode'\)/);
 for(const key of ['passwordNeedsVerificationCode','verificationCode','incorrectCodeTryAgain','couldNotStartVerification']) {
  assert.ok(en[key]?.trim(),`en has ${key}`);
  assert.ok(ar[key]?.trim(),`ar has ${key}`);
 }
});
