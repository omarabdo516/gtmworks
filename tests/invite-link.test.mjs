import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateLinkSecret, inviteLink, linkSecretHash, linkSecretShape } from '../lib/company-link.mjs';
import { generateOwnerSecret, ownerSecretHash } from '../lib/owner-link.mjs';
import { inviteLinkInput } from '../lib/first-run-input.mjs';

// The Invite link (#950, ADR 0019) is made the way the first-Owner link is (#383): a 256-bit secret after `#code=`, only
// its sha256 kept, and the page sends the secret in a form body, never in an address.
const action=readFileSync('app/invite-link-actions.ts','utf8');
const route=readFileSync('app/join/submit/route.ts','utf8');
const form=readFileSync('app/join/form.tsx','utf8');

test('an Invite link secret has 256 bits and sits after # in the address, never before it', () => {
 const secret=generateLinkSecret();
 assert.match(secret,linkSecretShape);
 assert.notEqual(secret,generateLinkSecret());
 const link=inviteLink('https://app.example.test',secret);
 assert.equal(link,`https://app.example.test/join#code=${secret}`);
 assert.equal(link.slice(0,link.indexOf('#')).includes(secret),false,'nothing before # names the secret');
 assert.match(form,/setupCodeFromHash\(window\.location\.hash\)/);
 assert.match(form,/body\.set\('code',code\)/);
});

test('the first-Owner link and the Invite link share one secret and one hash', () => {
 assert.equal(generateOwnerSecret,generateLinkSecret);
 assert.equal(ownerSecretHash,linkSecretHash);
 const secret=generateLinkSecret();
 assert.equal(linkSecretHash(secret),createHash('sha256').update(secret).digest('hex'));
});

test('only the hash reaches the database: the action sends it with the Administrator\'s session, the route looks it up by it', () => {
 assert.match(action,/rpc\('make_invite_link',\{c:company,label,link_role:role,agents,link_hash:linkSecretHash\(secret\)\}\)/);
 assert.doesNotMatch(action,/link_hash:secret\b/);
 assert.match(route,/hash=linkSecretHash\(secret\)/);
 assert.match(route,/rpc\('invite_link_open',\{link_hash:hash\}\)/);
 assert.match(route,/rpc\('claim_invite_link',\{link_hash:hash,person,person_name:input\.name,language:input\.language\}\)/);
 assert.doesNotMatch(route,/link_hash:secret\b/);
});

test('a Person with an account signs in on the join page and the signed-in session sends the form (#952)', () => {
 // The page swaps to a sign-in form that keeps the link's secret in the body and marks itself, so the server reads the
 // Person from the session the browser just made instead of making an account. The password never goes in that form.
 assert.match(form,/signInWithPassword/);
 assert.match(form,/signedInForm\.current\?\.submit\(\)/);
 assert.match(form,/ref=\{signedInForm\}[\s\S]{0,300}name="mode" value="signin"/);
 assert.doesNotMatch(form,/ref=\{signedInForm\}[\s\S]{0,300}name="password"/);
 assert.match(route,/form\.get\('mode'\)==='signin'/);
 assert.match(route,/auth\.getUser\(\)/);
 assert.match(route,/rpc\('claim_invite_link',\{link_hash:hash,person:user\.id,person_name:null,language\}\)/);
 // An active Member is told so by the page's own check of the still-unused link (#775).
 assert.match(route,/alreadyMember/);
 assert.match(route,/#code=\$\{secret\}/);
 assert.doesNotMatch(route,/already=1/);
 // A failed signed-in join comes back in sign-in mode, so its error sits under the sign-in form (#952).
 assert.match(route,/invalid=signIn&mode=signin/);
 assert.match(route,/invalid=1&mode=signin/);
 // The page asks whether the signed-in person is already a Member without spending the link.
 assert.match(route,/rpc\('invite_link_member',\{link_hash:hash,person:user\.id\}\)/);
 assert.match(form,/checked\.member/);
});

test('the join page asks for a name, email and password, and nothing about the Company or the Role', () => {
 const values={name:' نور ',email:' Nour@Example.com ',language:'ar',password:'long-enough-1',confirm:'long-enough-1'};
 const read=entries=>({get:name=>Object.hasOwn(entries,name)?entries[name]:null});
 assert.deepEqual(inviteLinkInput(read(values)),{name:'نور',email:'nour@example.com',language:'ar',password:'long-enough-1'});
 for(const change of [{name:''},{email:'bad'},{language:'fr'},{password:'short'},{confirm:'another-password'}])
  assert.equal(inviteLinkInput(read({...values,...change})),null,JSON.stringify(change));
 assert.deepEqual(inviteLinkInput(read({...values,role:'owner',company:'Other'})),{name:'نور',email:'nour@example.com',language:'ar',password:'long-enough-1'});
});
