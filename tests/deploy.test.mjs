import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapSql, validateEmail } from '../scripts/bootstrap-owner.mjs';
import { verifyResult } from '../scripts/verify-db.mjs';

const root=resolve('.');
// All command tests replace the CLI with this executable. No cloud credentials or calls.
function sandbox(t) {
 const dir=mkdtempSync(join(tmpdir(),'gtmworks-deploy-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const log=join(dir,'calls.jsonl');
 mkdirSync(join(dir,'bin'));
 writeFileSync(join(dir,'bin/supabase'),`#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
const call={args,cwd:process.cwd()};
if(args.includes('--file')) call.sql=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
fs.appendFileSync(process.env.STUB_LOG,JSON.stringify(call)+'\\n');
if(args[0]==='db' && args[1]==='query' && call.sql.includes('do $bootstrap$') && process.env.STUB_OWNER_EXISTS) {
 console.error('second Owner refused'); process.exit(1);
}
`,{mode:0o700});
 const env={PATH:`${dir}/bin:${process.env.PATH}`,HOME:dir,STUB_LOG:log};
 const calls=()=>{try { return readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); } catch { return []; }};
 const bootstrap=(args,extra={})=>spawnSync(process.execPath,[join(root,'scripts/bootstrap-owner.mjs'),...args],{cwd:dir,env:{...env,...extra},encoding:'utf8',timeout:10000});
 return {dir,env,calls,bootstrap};
}

test('verification accepts plain rows and agent envelopes', ()=>{
 const rows=[{read_back:{rls:[{table:'companies',rls:true}],columns:[{column:'id'}]}}];
 assert.doesNotThrow(()=>verifyResult(rows));
 assert.doesNotThrow(()=>verifyResult({rows,boundary:'fixture',warning:'untrusted data'}));
});

test('verification identifies the file and every false or null key without string values', ()=>{
 const file='20261111000000_member_agent_roles.verify.sql';
 assert.throws(()=>verifyResult([{a:true,b:false}],file),error=>{
  assert.ok(error.message.includes(file));
  assert.match(error.message,/\bb\b/);
  return true;
 });
 const rows=[{read_back:{a:true,b:false,nested:{c:null,credential:'private-value'},items:[{d:false}]}}];
 for(const result of [rows,{rows,warning:'private-envelope'}]) {
  assert.throws(()=>verifyResult(result,file),error=>{
   for(const key of [file,'read_back.b=false','nested.c=null','items[0].d=false']) assert.ok(error.message.includes(key),error.message);
   for(const value of ['private-value','private-envelope']) assert.ok(!error.message.includes(value));
   return true;
  });
 }
});

test('verification CLI names malformed input and never echoes readbacks', ()=>{
 const file='fixture.verify.sql';
 for(const input of ['private-credential','{}','[]','[{"text":"private-credential"}]']) {
  const result=spawnSync(process.execPath,['scripts/verify-db.mjs',file],{input,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.ok(result.stderr.includes(file),result.stderr);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('private-credential'));
 }
 const success=spawnSync(process.execPath,['scripts/verify-db.mjs',file],{input:'[{"ok":true,"credential":"private-credential"}]',encoding:'utf8'});
 assert.equal(success.status,0,success.stderr);
 assert.match(success.stdout,/fixture\.verify\.sql: Database verification passed/);
 assert.ok(!`${success.stdout}${success.stderr}`.includes('private-credential'));
});

test('verification rejects failed readbacks, null, empty and malformed output', ()=>{
 for(const output of ['{"rows":[{"result":{"ok":false}}]}','{"rows":[{"read_back":{"rls":[{"table":"extra","rls":false}]}}]}','{"rows":[{"ok":null}]}','{"rows":[],"success":true}','{"rows":[{"text":"no assertions"}]}','[{"ok":false}]','[{"ok":null}]','[{"text":"no assertions"}]','[]','{}','not-json']) {
  const result=spawnSync(process.execPath,['scripts/verify-db.mjs','fixture.verify.sql'],{input:output,encoding:'utf8'});
  assert.notEqual(result.status,0,output);
 }
 assert.throws(()=>verifyResult({rows:[{rls:false}]}),/false/);
 const rls=spawnSync(process.execPath,['scripts/verify-db.mjs','scripts/check-rls.sql'],{input:'[{"json_build_object":{"all_public_tables_have_rls":false}}]',encoding:'utf8'});
 assert.notEqual(rls.status,0);
 assert.match(rls.stderr,/check-rls\.sql.*all_public_tables_have_rls=false/);
});

test('bootstrap validates email before CLI', t=>{
 const s=sandbox(t);
 for(const args of [[],['bad'],['one@example.test','two@example.test'],['a@b.test\n']]) {
  const result=s.bootstrap(args); assert.notEqual(result.status,0); assert.match(result.stderr,/usage/);
 }
 assert.deepEqual(s.calls(),[]);
 assert.equal(validateEmail('Owner@Example.test'),'owner@example.test');
 const sql=bootstrapSql("o'$bootstrap$@example.test");
 assert.ok(!sql.includes("o'$bootstrap$@example.test"));
});

test('bootstrap propagates second-Owner refusal and has no remote target', t=>{
 const s=sandbox(t);
 const result=s.bootstrap(['owner@example.test'],{STUB_OWNER_EXISTS:'true'});
 assert.notEqual(result.status,0); assert.match(result.stderr,/Owner already exists/);
 const success=s.bootstrap(['owner@example.test']); assert.equal(success.status,0,success.stderr);
 for(const call of s.calls()) {
  assert.deepEqual(call.args.slice(0,2),['db','query']);
  assert.ok(!call.args.some(arg=>arg.startsWith('--remote') || arg==='--linked'));
  assert.match(call.sql,/do \$bootstrap\$/);
 }
});

test('local Auth closes signup, allows only local redirects and sends no real email', ()=>{
 const config=readFileSync('supabase/config.toml','utf8');
 assert.match(config,/^site_url = "http:\/\/127\.0\.0\.1:3000"$/m);
 assert.match(config,/^enable_signup = false$/m);
 const smtp=config.split(/^\[auth\.email\.smtp\][ \t]*$/m)[1]?.split(/^\[/m)[0];
 assert.ok(smtp,'the SMTP section exists');
 assert.match(smtp,/^enabled = false$/m);
});
