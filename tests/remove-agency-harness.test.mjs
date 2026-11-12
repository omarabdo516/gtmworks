import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { topLevelStatements } from './sql-statements.mjs';

// tests/remove-agency-migration.mjs replays the migration on a database where it is already applied, after putting the
// earlier shape back. Whatever the migration makes with a plain `create` would already exist there, so the harness must
// remove it before the replay; otherwise the replay stops at that statement (CI 43328130930: keep_hermes_destination
// already exists) and the pgTAP plan runs short. Read as text here, so no database is needed.
const migration=readFileSync('supabase/migrations/20261204000000_remove_agency.sql','utf8');
const harness=readFileSync('tests/remove-agency-migration.mjs','utf8');
const setup=harness.slice(harness.indexOf('const sql=`'),harness.indexOf('select throws_ok('));
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

test('the harness removes everything the migration creates before it replays it', () => {
 assert.ok(setup.length>100,'the earlier-shape setup was found');
 const needed=topLevelStatements(migration).map(statement=>statement.replace(/\s+/g,' ')).flatMap(statement=>{
  const fn=statement.match(/^create function (public\.\w+)\(/i);
  if(fn) return [{object:`function ${fn[1]}`,undo:new RegExp(`drop function (if exists )?${escape(fn[1])}\\(`)}];
  const trigger=statement.match(/^create trigger (\w+) .*? on (public\.\w+)/i);
  if(trigger) return [{object:`trigger ${trigger[1]}`,undo:new RegExp(`drop trigger (if exists )?${trigger[1]} on ${escape(trigger[2])}\\b`)}];
  const policy=statement.match(/^create policy (\w+) on (public\.\w+)/i);
  if(policy) return [{object:`policy ${policy[1]}`,undo:new RegExp(`drop policy (if exists )?${policy[1]} on ${escape(policy[2])}\\b`)}];
  const type=statement.match(/^create type (public\.\w+)/i);
  if(type) return [{object:`type ${type[1]}`,undo:new RegExp(`(alter type ${escape(type[1])} rename to|drop type (if exists )?${escape(type[1])}\\b)`)}];
  return [];
 });
 assert.ok(needed.some(({object})=>object==='function public.keep_hermes_destination'),'the plain creates were read');
 assert.deepEqual(needed.filter(({undo})=>!undo.test(setup)).map(({object})=>object),[]);
});
