import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { firstRunInput } from '../lib/first-run-input.mjs';
import { logActionFailure } from '../lib/diagnostics.mjs';
import { appUrl } from '../lib/app-origin.mjs';
import { generateSetupCode, setupCodeMatches } from '../lib/setup-code.mjs';
import * as i18n from '../lib/i18n.mjs';

const require=createRequire(import.meta.url);
// Execute the real route and hook with only their I/O replaced; no server or database.
function load(file,imports,globals={}) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext}});
 runInNewContext(outputText,{exports,require:name=>imports[name] ?? require(name),URL,Error,process,...globals});
 return exports;
}

test('first-run refusals log distinct causes and retain their responses and account cleanup',async t=>{
 const code=generateSetupCode();
 process.env.SETUP_CODE=code;
 const marker='marker-password-41';
 const input={name:'Owner',email:'owner@example.test',company:'Company',language:'en',code,password:marker,confirm:marker};
 const authError={name:'AuthApiError',code:'email_exists',status:422,message:'User owner@example.test already exists',email:input.email};
 const sqlError={code:'23503',message:'Foreign key violation',details:input.email};
 for(const scenario of [
  {name:'closed at start',open:[false],actions:['first_run_setup_closed'],status:404},
  {name:'invalid input',input:{...input,name:''},actions:['first_run_invalid_input'],status:303},
  // Only the link the installer printed opens setup (issue #50): nothing is created without its code.
  {name:'no setup code',input:{...input,code:undefined},actions:['first_run_wrong_code'],status:403},
  {name:'wrong setup code',input:{...input,code:generateSetupCode()},actions:['first_run_wrong_code'],status:403},
  {name:'wrong setup code in Arabic',input:{...input,code:'guess',language:'ar'},actions:['first_run_wrong_code'],status:403},
  {name:'closed before the code is checked',input:{...input,code:'guess'},open:[false],actions:['first_run_setup_closed'],status:404},
  {name:'Auth error',authError,actions:['first_run_createUser'],status:303},
  {name:'Auth returned no user',noUser:true,actions:['first_run_createUser'],status:303},
  {name:'setup closed after Auth error',authError,open:[true,false],actions:['first_run_createUser','first_run_setup_closed_after_createUser'],status:404},
  {name:'RPC error',sqlError,actions:['complete_setup'],status:404,cleanup:1},
  {name:'empty slug',slug:'',actions:['first_run_empty_slug'],status:404,cleanup:1},
  {name:'cleanup error',sqlError,cleanupError:true,actions:['complete_setup','first_run_cleanup'],cleanup:1},
  {name:'short password',input:{...input,password:'short',confirm:'short'},actions:['first_run_invalid_input'],status:303,location:'/first-run?invalid=passwordTooShort&language=en'},
  {name:'mismatched password',input:{...input,confirm:'something-else'},actions:['first_run_invalid_input'],status:303,location:'/first-run?invalid=passwordsDoNotMatch&language=en'},
  {name:'sign-in after setup fails',signInError:{name:'AuthApiError',code:'unexpected_failure',status:500,message:'Database error'},actions:['first_run_signIn'],status:303,location:'/sign-in?next=%2Fc%2Fcompany-slug%2Fhome&language=en'},
  {name:'successful setup',actions:[],status:303,location:'/c/company-slug/home'},
 ]) await t.test(scenario.name,async()=>{
  const lines=[],open=[...(scenario.open ?? [true])];
  let deleted=0,created=0,completed=0;
  const admin={auth:{admin:{
   createUser:async params=>{created++; assert.equal(params.password,marker); return {data:{user:scenario.authError || scenario.noUser?null:{id:'person-id'}},error:scenario.authError};},
   deleteUser:async id=>{assert.equal(id,'person-id'); deleted++; return {error:scenario.cleanupError};},
  }},rpc:async()=>(completed++,{data:scenario.slug ?? 'company-slug',error:scenario.sqlError})};
  const {POST}=load('app/first-run/submit/route.ts',{
   '@/lib/first-run':{setupIsOpen:async()=>open.length>1?open.shift():open[0],setupAdmin:()=>admin},
   '@/lib/first-run-input.mjs':{firstRunInput},
   '@/lib/password.mjs':await import('../lib/password.mjs'),
   // The Owner is signed in with the password just chosen: no email is sent.
   '@/lib/supabase':{supabase:async()=>({auth:{signInWithPassword:async credentials=>{assert.deepEqual({...credentials},{email:input.email,password:marker}); return {error:scenario.signInError ?? null};},signInWithOtp:()=>assert.fail('no email step')}})},
   '@/lib/diagnostics.mjs':{logActionFailure:(action,error)=>logActionFailure(action,error,{write:line=>lines.push(line)})},
   '@/lib/app-origin.mjs':{appUrl},
   '@/lib/setup-code.mjs':{setupCodeMatches},
   '@/lib/i18n.mjs':i18n,
  });
  const {NextRequest}=require('next/server');
  const body=Object.fromEntries(Object.entries(scenario.input ?? input).filter(([,value])=>value!==undefined));
  const request=new NextRequest('http://127.0.0.1:3000/first-run/submit',{method:'POST',body:new URLSearchParams(body)});
  if(scenario.cleanupError) await assert.rejects(POST(request),/Setup account cleanup failed/);
  else if(scenario.status===404) await assert.rejects(POST(request),error=>error.digest==='NEXT_HTTP_ERROR_FALLBACK;404');
  else if(scenario.status===403) {
   const response=await POST(request);
   assert.equal(response.status,403);
   assert.equal(await response.text(),i18n.i18n(body.language).t('setupNeedsLink'));
   assert.equal(created+completed,0,'nothing is created without the right code');
  }
  else {
   const response=await POST(request);
   assert.equal(response.status,scenario.status);
   if(scenario.location) assert.equal(new URL(response.headers.get('location')).pathname+new URL(response.headers.get('location')).search,scenario.location);
  }
  const entries=lines.map(line=>JSON.parse(line));
  assert.deepEqual(entries.map(entry=>entry.action),scenario.actions);
  assert.equal(deleted,scenario.cleanup ?? 0);
  assert.doesNotMatch(lines.join('\n'),/owner@example\.test/);
  assert.ok(!lines.join('\n').includes(code),'the setup code is never logged');
  assert.doesNotMatch(lines.join('\n'),new RegExp(marker));
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
