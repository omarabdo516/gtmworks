import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineTarget } from '../lib/engine-targets.mjs';

// The every-Engine check (#386, ADR 0018) runs a Company when its main Agent exists and its Engine record answers. A
// Company made straight in the database by a proof has no main Agent and is left alone; a Company with a main Agent and
// no readable Engine is a broken install and fails the check (#378, C2), rather than being skipped as if it were a probe.
const company={id:'10000000-0000-4000-8000-000000000001',name:'Acme'};
const agent={id:'a-1',profile:'co-10000000000000000000000000000001'};
const engine={address:'http://gtmworks-engine-acme:8642',key:'k'.repeat(64)};

test('a Company with a main Agent and an Engine is one the every-Engine check runs', () => {
 assert.deepEqual(engineTarget({company,agent,engine}),{
  company:company.id,name:'Acme',agent:'a-1',profile:agent.profile,engine,
  code:`backup-${company.id.replaceAll('-','')}`,
  management:'http://gtmworks-engine-acme:9119',
 });
});

test('a Company with no main Agent yet is left alone, Engine or not', () => {
 assert.equal(engineTarget({company,agent:null,engine}),null);
 assert.equal(engineTarget({company,agent:{id:'a-1'},engine}),null);
 assert.equal(engineTarget({company,agent:undefined,engine:null}),null);
});

test('a Company with a main Agent and no readable Engine fails the check instead of being skipped', () => {
 for(const missing of [null,undefined,{address:'http://gtmworks-engine-acme:8642'},{key:'k'.repeat(64)}]) {
  assert.throws(()=>engineTarget({company,agent,engine:missing}),
   /Acme has a main Agent and no Engine record that answers for it/,JSON.stringify(missing));
 }
});
