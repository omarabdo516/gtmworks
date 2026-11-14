import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { actionPermissions, outsideCompany, permitted, requiredFor, roleOrder, routePermissions } from '../lib/route-permissions.mjs';

// Rule b of 2026-11-13: every server route and server action is in one table (lib/route-permissions.mjs), anything
// missing needs Owner, and the role is read from the database on every request.
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const sourceFiles = directory => globSync(`${directory}/**/*.{ts,tsx,mjs}`).map(path => path.replaceAll('\\', '/')).filter(path => !path.endsWith('.d.mts')).sort();
const routeFiles = () => globSync('app/**/route.{ts,tsx,js,mjs}').map(path => path.replaceAll('\\', '/')).sort();
// Every file that defines server actions: its first statement is the 'use server' directive (anywhere in the code, not
// only files named *actions.ts).
const isServerFile = source => { const first = ts.createSourceFile('f.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements[0]; return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server'; };
const actionFiles = () => ['app', 'lib', 'components'].flatMap(sourceFiles).filter(file => isServerFile(read(file)));
// Every name a module exports, however it is written: export function, export async function, export const/let,
// export { handler as DELETE }, and export default.
export function exportedNames(source) {
  const names = [];
  const exported = node => ts.canHaveModifiers(node) && (ts.getModifiers(node) || []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = node => (ts.getModifiers(node) || []).some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  for (const statement of ts.createSourceFile('f.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && exported(statement)) names.push(isDefault(statement) ? 'default' : statement.name?.text || 'default');
    else if (ts.isVariableStatement(statement) && exported(statement)) for (const declaration of statement.declarationList.declarations) names.push(declaration.name.getText());
    else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) names.push(element.name.text);
    else if (ts.isExportAssignment(statement)) names.push('default');
  }
  return names;
}
const exportedMethods = source => exportedNames(source).filter(name => methods.includes(name));
// In a 'use server' file every export is an action.
const exportedActions = source => isServerFile(source) ? exportedNames(source) : [];

// What the tree has that the table lacks: route files, methods of a listed file, and actions.
export function uncovered(files, read, table = routePermissions, actions = actionPermissions) {
  const missing = [];
  for (const file of files) {
    const source = read(file);
    if (/\/route\.(ts|tsx|js|mjs)$/.test(file)) {
      if (!Object.hasOwn(table, file)) { missing.push(file); continue; }
      for (const method of exportedMethods(source)) if (!Object.hasOwn(table[file], method)) missing.push(`${file} ${method}`);
    } else for (const action of exportedActions(source)) if (!Object.hasOwn(actions, action)) missing.push(`${file} ${action}`);
  }
  return missing;
}
// Routes and actions that do not check their own entry where they run.
export function unguarded(files, read) {
  const problems = [];
  for (const file of files) {
    const source = read(file);
    if (/\/route\.(ts|tsx|js|mjs)$/.test(file)) {
      const levels = new Set(Object.values(routePermissions[file] || { any: 'owner' }));
      if (levels.has('agentKey')) { if (!/authenticateAgent\(/.test(source)) problems.push(file); }
      else if (levels.has('setupCode')) { if (!/setupCodeMatches\(/.test(source)) problems.push(file); }
      else if (![...levels].every(level => level === 'public') && !(source.includes('routeAllowed(') && source.includes(`'${file}'`))) problems.push(file);
    } else for (const action of exportedActions(source)) if (requiredFor(actionPermissions, action) !== 'public' && !source.includes(`actionAllowed(db,'${action}'`)) problems.push(`${file} ${action}`);
  }
  return problems;
}
const read = file => readFileSync(file, 'utf8');

test('every route file, method and server action is in the permission table', () => {
  const files = [...routeFiles(), ...actionFiles()];
  assert.ok(routeFiles().length >= 14 && actionFiles().length >= 8, 'the route and action files were found');
  assert.deepEqual(uncovered(files, read), []);
});

test('a route or action added without a table entry is reported, and needs Owner', () => {
  const sources = {
    'app/api/new-thing/route.ts': 'export async function POST() {}',
    'app/c/[slug]/new-actions.ts': "'use server';\nexport const doNewThing=withActionLog('doNewThing',async()=>{});",
    'app/api/config/route.ts': 'export function GET() {}\nconst handler=async()=>{};\nexport { handler as DELETE };',
    'lib/sneaky.ts': "'use server';\nexport async function sneaky(form) {}\nconst other=async()=>{};\nexport { other as renamedAction };",
    'lib/not-server.ts': 'export async function helper() {}',
  };
  assert.deepEqual(uncovered(Object.keys(sources), file => sources[file]), ['app/api/new-thing/route.ts', 'app/c/[slug]/new-actions.ts doNewThing', 'app/api/config/route.ts DELETE', 'lib/sneaky.ts sneaky', 'lib/sneaky.ts renamedAction']);
  assert.deepEqual(unguarded(['app/c/[slug]/new-actions.ts', 'lib/sneaky.ts', 'app/api/new-thing/route.ts'], file => sources[file]), ['app/c/[slug]/new-actions.ts doNewThing', 'lib/sneaky.ts sneaky', 'lib/sneaky.ts renamedAction', 'app/api/new-thing/route.ts']);
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
  assert.deepEqual(unguarded([...routeFiles(), ...actionFiles()], read), []);
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
