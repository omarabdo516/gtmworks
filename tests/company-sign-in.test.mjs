import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// #384, ADR 0018: a Company signs in once on the root profile of its own Engine. The code that told an install with one
// Company from an install with several, the "shared sign-in" state and the warning that two Companies share an Engine
// are gone from the sources, the screens, both catalogues and the tests — this file names them so it leaves itself out.
const removed=['oneCompany','one_company','install_has_one_company','bundled_engine_shared','sharedEngine','sharedEngineWarning','signInShared','signInSharedWarning','signInOneCompany','signInOwnSpace'];
const roots=['app','lib','components','worker','scripts','supabase/tests','tests'];
const skip=new Set(['tests/company-sign-in.test.mjs','tests/ci-logs']);
function sources(dir) {
 return readdirSync(dir,{recursive:true}).filter(name=>statSync(join(dir,name)).isFile())
  .map(name=>`${dir}/${name.split('\\').join('/')}`).filter(file=>!skip.has(file));
}
const files=roots.flatMap(sources);

test('the one-Company-or-several sign-in, the shared sign-in state and the shared Engine warning are gone', () => {
 assert.ok(files.length>100,'the scan reads the sources');
 for(const file of files) {
  const text=readFileSync(file,'utf8');
  for(const name of removed) assert.ok(!text.includes(name),`${file} still names ${name}`);
 }
});

test('the sign-in page says one account serves one Company, in both languages, and Settings shows the Claude command', () => {
 const en=JSON.parse(readFileSync('lib/messages/en.json','utf8')); const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));
 assert.equal(en.signInOneAccount,'One account serves one Company.');
 assert.match(ar.signInOneAccount,/^[^A-Za-z]+$/,'the Arabic line is Arabic');
 const client=readFileSync('app/settings-providers.tsx','utf8');
 assert.match(client,/t\('signInOneAccount'\)/);
 assert.match(client,/gtmworks sign-in claude --company/);
 const get=readFileSync('scripts/get.sh','utf8');
 assert.match(get,/sign-in claude --company/);
 // The sign-in itself is the installer's own (#378, T4), still on the Company's Engine root profile.
 const install=readFileSync('scripts/install.sh','utf8');
 assert.match(install,/hermes auth add anthropic --type oauth --no-browser/,'the Engine\'s own Claude sign-in, on its root profile');
});

test('the database answers the Company\'s profiles and no longer asks whether the install has one Company', () => {
 const migration=readFileSync('supabase/migrations/20270403000000_company_sign_in_one_engine.sql','utf8');
 assert.match(migration,/drop function public\.install_has_one_company\(\)/);
 assert.match(migration,/drop function public\.bundled_engine_shared\(uuid\)/);
 assert.match(migration,/drop function public\.company_engine_target\(uuid\)/);
 assert.match(migration,/create function public\.company_engine_target\(c uuid\) returns table\(profile text, profiles text\[\]\)/);
 assert.match(migration,/public\.is_member\(c\)/);
});

test('the README says a Company\'s sign-in is on its own Engine, never shared with another Company',()=>{
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 assert.ok(readme.includes('A Company\'s subscription is signed in once on its own Engine\'s root profile, and every Agent of that Company uses it.'));
 assert.ok(readme.includes('Another Company\'s Engine and its Agents never see it.'));
});
