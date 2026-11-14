import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRunInput } from '../lib/first-run-input.mjs';

test('first-run accepts authored names and the chosen language, ignoring extra fields', () => {
 assert.deepEqual(firstRunInput(new FormDataBuilder({name:' عمر ',email:' OWNER@example.com ',company:' الشركة الأولى ',language:'ar',password:'long-enough-1',confirm:'long-enough-1',role:'viewer'})),
  {name:'عمر',email:'owner@example.com',company:'الشركة الأولى',language:'ar',password:'long-enough-1'});
});
test('first-run refuses invalid or unbounded input before provisioning', () => {
 for (const change of [{name:''},{company:' '},{email:'bad'},{email:'owner\u0000@example.test'},{language:'fr'},{name:'a'.repeat(121)},{company:'a'.repeat(121)},{email:`${'a'.repeat(250)}@a.test`}]) {
  assert.equal(firstRunInput(new FormDataBuilder({name:'Owner',email:'owner@example.com',company:'Company',language:'en',password:'long-enough-1',confirm:'long-enough-1',...change})),null);
 }
});
function FormDataBuilder(values) {
 const form=new FormData();
 for(const [key,value] of Object.entries(values)) form.set(key,value);
 return form;
}

test('setup diagnostics retain the Postgres cause without logging row details', async () => {
 const {logActionFailure}=await import('../lib/diagnostics.mjs');
 const lines=[];
 logActionFailure('complete_setup',{code:'23503',message:'insert or update violates foreign key constraint',details:'First owner setup@example.test',hint:'First Company'}, {write:line=>lines.push(line)});
 const entry=JSON.parse(lines[0]);
 assert.equal(entry.event,'server_action_failed');
 assert.equal(entry.action,'complete_setup');
 assert.equal(entry.code,'23503');
 assert.equal(entry.message,'insert or update violates foreign key constraint');
 assert.doesNotMatch(lines[0],/First owner|setup@example\.test|First Company/);
});

test('destructive first-run helpers refuse remote app and Supabase targets', async () => {
 const {assertLocalTarget,resetFirstRun}=await import('../scripts/first-run-db.mjs');
 assert.doesNotThrow(()=>assertLocalTarget('http://127.0.0.1:3000','http://127.0.0.1:54321'));
 for(const [app,api] of [['https://app.example.com','http://127.0.0.1:54321'],['http://127.0.0.1:3000','https://example.supabase.co']]) {
  assert.throws(()=>assertLocalTarget(app,api),/refuse non-local/);
 }
 assert.throws(()=>resetFirstRun('https://app.example.com'),/refuse non-local/);
});
