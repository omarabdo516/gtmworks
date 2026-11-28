import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateOwnerSecret, ownerLink, ownerSecretHash } from '../lib/owner-link.mjs';
import { ownerLinkInput } from '../lib/first-run-input.mjs';

// The first-Owner link (#383, ADR 0019): its secret sits after `#` in the address, only its hash is kept, and the Company
// a link names is made with its sender as Owner through the one function that makes both, as `company add --owner` does.
const command=readFileSync('scripts/company-add.mjs','utf8');
const route=readFileSync('app/first-owner/submit/route.ts','utf8');
const form=readFileSync('app/first-run/form.tsx','utf8');

test('a first-Owner secret has 256 bits and sits after # in the address, never before it', () => {
 const secret=generateOwnerSecret(), other=generateOwnerSecret();
 assert.match(secret,/^[a-f0-9]{64}$/);
 assert.notEqual(secret,other);
 const link=ownerLink('https://app.example.test',secret);
 assert.equal(link,`https://app.example.test/first-owner#code=${secret}`);
 assert.ok(link.slice(link.indexOf('#')).includes(secret),'the secret is in the fragment');
 assert.equal(link.slice(0,link.indexOf('#')).includes(secret),false,'nothing before # names the secret');
 // The page reads the same `#code=` fragment the setup link uses, so no request ever carries the secret in an address.
 assert.match(form,/setupCodeFromHash\(window\.location\.hash\)/);
 assert.match(form,/body\.set\('code',code\)/);
});

test("only the secret's hash is kept: sha256 in hex, and neither the command nor the route writes or prints the secret", () => {
 const secret=generateOwnerSecret(), hash=ownerSecretHash(secret);
 assert.match(hash,/^[a-f0-9]{64}$/);
 assert.equal(hash,createHash('sha256').update(secret).digest('hex'));
 assert.notEqual(hash,secret);
 // The command stores the hash and prints the link, whose secret is the only copy anyone holds.
 assert.match(command,/secret_hash:ownerSecretHash\(secret\)/);
 assert.doesNotMatch(command,/secret_hash\s*:\s*secret\b/);
 assert.match(command,/ownerLink\(appUrl\('\/'\)\.origin,secret\)/);
 assert.doesNotMatch(command,/process\.stdout\.write\([^)]*ownerSecretHash/,'the hash is never printed');
 // The route hashes what the form sent and looks the link up by that hash only.
 assert.match(route,/hash=ownerSecretHash\(secret\)/);
 assert.match(route,/eq\('secret_hash',hash\)/);
 assert.doesNotMatch(route,/eq\('secret_hash',secret\)/);
});

test('the command and the link claim make a Company and its Owner through the one transaction function', () => {
 // `company add --owner` no longer inserts a Company and then a member in two writes (#383 closes that gap): the one
 // function makes the Company on the named Engine record together with its Owner member.
 assert.match(command,/rpc\('create_company_with_owner',\{engine:made\.id,company_name:name,person:person\.id,person_name:null,language:null,slug:companySlug\}\)/);
 assert.doesNotMatch(command,/from\('members'\)\.insert/,'no separate Owner insert is left');
 assert.match(route,/rpc\('claim_company_owner_link',\{link_hash:hash,person,person_name:input\.name,language:input\.language\}\)/);
});

test('the link page asks for a name, email and password, and takes no Company name from the form', () => {
 const values={name:' عمر ',email:' OWNER@example.com ',language:'ar',password:'long-enough-1',confirm:'long-enough-1'};
 assert.deepEqual(ownerLinkInput(new FormDataBuilder(values)),{name:'عمر',email:'owner@example.com',language:'ar',password:'long-enough-1'});
 for(const change of [{name:''},{email:'bad'},{language:'fr'},{name:'a'.repeat(121)},{password:'short'},{confirm:'another-password'}])
  assert.equal(ownerLinkInput(new FormDataBuilder({...values,...change})),null,JSON.stringify(change));
 // The Company is the link's, so a `company` field in the form changes nothing.
 assert.deepEqual(ownerLinkInput(new FormDataBuilder({...values,company:'Another Company'})),{name:'عمر',email:'owner@example.com',language:'ar',password:'long-enough-1'});
 assert.match(form,/owner\?<label[^>]*>\{t\('firstOwnerCompany'\)\}<Input[^>]*value=\{checked\.company\?\?''\}[^>]*readOnly\/>/);
});

function FormDataBuilder(values) {
 const form=new FormData();
 for(const [key,value] of Object.entries(values)) form.set(key,value);
 return form;
}
