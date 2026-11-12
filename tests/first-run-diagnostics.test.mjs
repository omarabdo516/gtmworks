import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { firstRunInput } from '../lib/first-run-input.mjs';
import { logActionFailure } from '../lib/diagnostics.mjs';
import { appUrl } from '../lib/app-origin.mjs';

const require=createRequire(import.meta.url);
// Execute the real route and hook with only their I/O replaced; no server or database.
function load(file,imports,globals={}) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext}});
 runInNewContext(outputText,{exports,require:name=>imports[name] ?? require(name),URL,Error,process,...globals});
 return exports;
}

test('first-run refusals log distinct causes and retain their responses and account cleanup',async t=>{
 const input={name:'Owner',email:'owner@example.test',company:'Company',language:'en'};
 const authError={name:'AuthApiError',code:'email_exists',status:422,message:'User owner@example.test already exists',email:input.email};
 const sqlError={code:'23503',message:'Foreign key violation',details:input.email};
 for(const scenario of [
  {name:'closed at start',open:[false],actions:['first_run_setup_closed'],status:404},
  {name:'invalid input',input:{...input,name:''},actions:['first_run_invalid_input'],status:303},
  {name:'Auth error',authError,actions:['first_run_createUser'],status:303},
  {name:'Auth returned no user',noUser:true,actions:['first_run_createUser'],status:303},
  {name:'setup closed after Auth error',authError,open:[true,false],actions:['first_run_createUser','first_run_setup_closed_after_createUser'],status:404},
  {name:'RPC error',sqlError,actions:['complete_setup'],status:404,cleanup:1},
  {name:'empty slug',slug:'',actions:['first_run_empty_slug'],status:404,cleanup:1},
  {name:'cleanup error',sqlError,cleanupError:true,actions:['complete_setup','first_run_cleanup'],cleanup:1},
  {name:'successful setup',actions:[],status:303},
 ]) await t.test(scenario.name,async()=>{
  const lines=[],open=[...(scenario.open ?? [true])];
  let deleted=0;
  const admin={auth:{admin:{
   createUser:async()=>({data:{user:scenario.authError || scenario.noUser?null:{id:'person-id'}},error:scenario.authError}),
   deleteUser:async id=>{assert.equal(id,'person-id'); deleted++; return {error:scenario.cleanupError};},
  }},rpc:async()=>({data:scenario.slug ?? 'company-slug',error:scenario.sqlError})};
  const {POST}=load('app/first-run/submit/route.ts',{
   '@/lib/first-run':{setupIsOpen:async()=>open.length>1?open.shift():open[0],setupAdmin:()=>admin},
   '@/lib/first-run-input.mjs':{firstRunInput},
   '@/lib/supabase':{supabase:async()=>({auth:{signInWithOtp:async()=>({error:null})}})},
   '@/lib/diagnostics.mjs':{logActionFailure:(action,error)=>logActionFailure(action,error,{write:line=>lines.push(line)})},
   '@/lib/app-origin.mjs':{appUrl},
  });
  const {NextRequest}=require('next/server');
  const request=new NextRequest('http://127.0.0.1:3000/first-run/submit',{method:'POST',body:new URLSearchParams(scenario.input ?? input)});
  if(scenario.cleanupError) await assert.rejects(POST(request),/Setup account cleanup failed/);
  else if(scenario.status===404) await assert.rejects(POST(request),error=>error.digest==='NEXT_HTTP_ERROR_FALLBACK;404');
  else assert.equal((await POST(request)).status,scenario.status);
  const entries=lines.map(line=>JSON.parse(line));
  assert.deepEqual(entries.map(entry=>entry.action),scenario.actions);
  assert.equal(deleted,scenario.cleanup ?? 0);
  assert.doesNotMatch(lines.join('\n'),/owner@example\.test/);
  if(scenario.authError) {
   assert.equal(entries[0].code,authError.code);
   assert.equal(entries[0].status,authError.status);
   assert.equal(entries[0].message,'User [redacted] already exists');
  }
  if(scenario.sqlError) assert.equal(entries[0].code,sqlError.code);
 });
});

test('failed first-run tests print only the last 40 matching server lines; passing tests and missing logs stay quiet',async()=>{
 let afterEach,reads=0,missing=false;
 const output=[];
 const playwright=Object.assign(()=>{},{beforeEach:()=>{},afterAll:()=>{},afterEach:hook=>{afterEach=hook;}});
 const log=Array.from({length:45},(_,i)=>`complete_setup failure ${i}\r\nunrelated line`).join('\r\n');
 load('tests/first-run.spec.ts',{
  '@playwright/test':{test:playwright},
  'node:fs/promises':{readFile:async path=>{
   reads++;
   assert.equal(path,`${process.cwd()}/playwright-report/server.log`);
   if(missing) throw Object.assign(new Error('Missing'),{code:'ENOENT'});
   return log;
  }},
  'node:path':require('node:path'),
  '../scripts/first-run-db.mjs':{},
  './sign-in':{},
 },{console:{log:line=>output.push(line)}});
 await afterEach({},{status:'passed',expectedStatus:'passed'});
 assert.equal(reads,0);
 await afterEach({},{status:'failed',expectedStatus:'passed'});
 assert.equal(output.length,1);
 assert.deepEqual(output[0].split('\n').slice(1),Array.from({length:40},(_,i)=>`complete_setup failure ${i+5}`));
 missing=true;
 await afterEach({},{status:'timedOut',expectedStatus:'passed'});
 assert.equal(output.length,1);
});
