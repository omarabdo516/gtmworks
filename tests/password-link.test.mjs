import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { generateLinkSecret, passwordLink } from '../lib/company-link.mjs';

// The password link (#954, ADR 0019) is made the way the Invite link is (#950): a 256-bit secret after `#code=`, only
// its sha256 kept, and the page sends the secret in a form body, never in an address. The install sends no reset email.
const action=readFileSync('app/password-link-actions.ts','utf8');
const route=readFileSync('app/password/submit/route.ts','utf8');
const form=readFileSync('app/password/form.tsx','utf8');

test('a password link\'s secret sits after # in the address, never before it, and the page sends it in a body', () => {
 const secret=generateLinkSecret();
 const link=passwordLink('https://app.example.test',secret);
 assert.equal(link,`https://app.example.test/password#code=${secret}`);
 assert.equal(link.slice(0,link.indexOf('#')).includes(secret),false,'nothing before # names the secret');
 assert.match(form,/setupCodeFromHash\(window\.location\.hash\)/);
 assert.match(form,/body\.set\('code',code\)/);
});

test('only the hash reaches the database: the action sends it with the maker\'s session, the route looks it up by it', () => {
 assert.match(action,/rpc\('make_password_link',\{c:company,person,link_hash:linkSecretHash\(secret\)\}\)/);
 assert.doesNotMatch(action,/link_hash:secret\b/);
 assert.match(route,/hash=linkSecretHash\(secret\)/);
 assert.match(route,/rpc\('password_link_open',\{link_hash:hash\}\)/);
 assert.match(route,/rpc\('claim_password_link',\{link_hash:hash\}\)/);
 assert.doesNotMatch(route,/link_hash:secret\b/);
 // The claim comes before the password is set, so a link refused by the database sets nothing.
 assert.ok(route.indexOf("rpc('claim_password_link'")<route.indexOf('updateUserById('),'claim, then the password');
});

test('the sign-in screens send no reset email', () => {
 for(const file of ['app/sign-in/actions.ts','app/auth/reset/page.tsx','app/reset-password/page.tsx']) assert.equal(existsSync(file),false,`${file} is gone`);
 const sources=['app/sign-in/form.tsx','app/sign-in/screen.tsx','app/forgot-password/page.tsx'].map(file=>readFileSync(file,'utf8')).join('\n');
 assert.doesNotMatch(sources,/resetPasswordForEmail|sendResetLink/);
 assert.match(readFileSync('app/sign-in/form.tsx','utf8'),/t\('forgotPasswordAsk'\)/);
});
