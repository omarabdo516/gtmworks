import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { actionPermissions, outsideCompany, permitted, requiredFor, roleOrder, routePermissions } from '../lib/route-permissions.mjs';

// Rule b of 2026-11-13: every server route and server action is in one table (lib/route-permissions.mjs), anything
// missing needs Owner, and the role is read from the database on every request.
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const routeFiles = () => globSync('app/**/route.ts').map(path => path.replaceAll('\\', '/')).sort();
const actionFiles = () => globSync('app/**/{actions,*-actions}.ts').map(path => path.replaceAll('\\', '/')).sort();
const exportedMethods = source => methods.filter(method => new RegExp(`export\\s+(const\\s+${method}\\b|(async\\s+)?function\\s+${method}\\b)`).test(source));
const exportedActions = source => [...source.matchAll(/export\s+const\s+(\w+)\s*=\s*withActionLog\(/g)].map(match => match[1]);

// What the tree has that the table lacks: route files, methods of a listed file, and actions.
export function uncovered(files, read, table = routePermissions, actions = actionPermissions) {
  const missing = [];
  for (const file of files) {
    const source = read(file);
    if (file.endsWith('/route.ts')) {
      if (!Object.hasOwn(table, file)) { missing.push(file); continue; }
      for (const method of exportedMethods(source)) if (!Object.hasOwn(table[file], method)) missing.push(`${file} ${method}`);
    } else for (const action of exportedActions(source)) if (!Object.hasOwn(actions, action)) missing.push(`${file} ${action}`);
  }
  return missing;
}
const read = file => readFileSync(file, 'utf8');

test('every route file, method and server action is in the permission table', () => {
  const files = [...routeFiles(), ...actionFiles()];
  assert.ok(routeFiles().length >= 14 && actionFiles().length >= 8, 'the route and action files were found');
  assert.deepEqual(uncovered(files, read), []);
});

test('a route or action added without a table entry is reported, and needs Owner', () => {
  const sources = { 'app/api/new-thing/route.ts': 'export async function POST() {}', 'app/c/[slug]/new-actions.ts': "export const doNewThing=withActionLog('doNewThing',async()=>{});", 'app/api/config/route.ts': 'export function GET() {}\nexport function DELETE() {}' };
  assert.deepEqual(uncovered(Object.keys(sources), file => sources[file]), ['app/api/new-thing/route.ts', 'app/c/[slug]/new-actions.ts doNewThing', 'app/api/config/route.ts DELETE']);
  assert.equal(requiredFor(routePermissions, 'app/api/new-thing/route.ts', 'POST'), 'owner');
  assert.equal(requiredFor(routePermissions, 'app/api/config/route.ts', 'DELETE'), 'owner');
  assert.equal(requiredFor(actionPermissions, 'doNewThing'), 'owner');
  // A misspelled level is never weaker than Owner.
  assert.equal(requiredFor({ 'app/x/route.ts': { GET: 'viewr' } }, 'app/x/route.ts', 'GET'), 'owner');
  assert.equal(requiredFor(actionPermissions, 'workAction', 'stage-settings'), 'manager');
  assert.equal(requiredFor(actionPermissions, 'workAction', 'comment'), 'contributor');
});

test('every table entry names a known level, and no route or action in it is gone from the tree', () => {
  const known = new Set([...roleOrder, ...outsideCompany]);
  for (const entry of [...Object.values(routePermissions).flatMap(Object.values), ...Object.values(actionPermissions).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))]) assert.ok(known.has(entry), entry);
  assert.deepEqual(Object.keys(routePermissions).filter(file => !routeFiles().includes(file)), []);
  const actions = actionFiles().flatMap(file => exportedActions(read(file)));
  assert.deepEqual(Object.keys(actionPermissions).filter(name => !actions.includes(name)), []);
});

test('each route and action checks its own entry where it runs', () => {
  for (const file of routeFiles()) {
    const source = read(file); const levels = new Set(Object.values(routePermissions[file]));
    if (levels.has('agentKey')) assert.match(source, /authenticateAgent\(/, file);
    else if (levels.has('setupCode')) assert.match(source, /setupCodeMatches\(/, file);
    else if (![...levels].every(level => level === 'public')) assert.ok(source.includes(`routeAllowed(`) && source.includes(`'${file}'`), `${file} calls routeAllowed with its own path`);
  }
  for (const file of actionFiles()) {
    const source = read(file);
    for (const action of exportedActions(source)) if (requiredFor(actionPermissions, action) !== 'public') assert.ok(source.includes(`actionAllowed(db,'${action}'`), `${file} ${action} calls actionAllowed with its own name`);
  }
});

// A database stand-in that answers the members query with whatever role the member holds at that moment.
function members(roles) {
  let reads = 0;
  const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: roles[reads++] ? { role: roles[reads - 1] } : null, error: null }) };
  return { db: { from: table => { assert.equal(table, 'members'); return query; }, auth: { getUser: async () => ({ data: { user: { id: 'person' } } }) } }, reads: () => reads };
}

test('the role is read again on every request: a role lowered between two requests refuses the second', async () => {
  const company = '10000000-0000-0000-0000-000000000001';
  const fake = members(['contributor', 'viewer']);
  assert.equal(await permitted(fake.db, 'contributor', company), true);
  assert.equal(await permitted(fake.db, 'contributor', company), false);
  assert.equal(fake.reads(), 2);
  // No place in the company, no company, or no session: refused; public and key-checked routes need no member row.
  assert.equal(await permitted(members([]).db, 'viewer', company), false);
  assert.equal(await permitted(members(['owner']).db, 'viewer', 'not-a-company'), false);
  assert.equal(await permitted({ auth: { getUser: async () => ({ data: { user: null } }) } }, 'signedIn'), false);
  assert.equal(await permitted({}, 'public'), true);
});
