import { globSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// These are imported browser helpers, not standalone tests.
const helpers = new Set(['tests/sign-in.ts', 'tests/navigation-measure.ts', 'tests/visual-screens.mjs', 'tests/fake-hermes.mjs', 'tests/fake-engine.mjs', 'tests/touch-diagnostics.mjs']);
const generated = new Set(['.git', 'node_modules', '.next', 'test-results', 'playwright-report', '.temp']);
function files(directory = '.') {
 return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (generated.has(entry.name)) return [];
  const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
  return entry.isDirectory() ? files(path) : [path];
 });
}

const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
// Read the actual npm command so reverting to a named list cannot fool the guard.
const unit = scripts.test.match(/^node --test (['"])([^'"]+)\1$/);
if (!unit || scripts['test:e2e'] !== 'playwright test' || scripts['test:e2e:proxy'] !== 'playwright test -c playwright.proxy.config.ts' || scripts['test:db'] !== 'bash tests/db.sh') {
 throw new Error('Test runner commands changed; update the discovery check with them.');
}
const database = readFileSync('tests/db.sh', 'utf8');
const covered = new Set([
 ...globSync(unit[2]),
 ...globSync('supabase/migrations/*.verify.sql'),
 'tests/db.sh',
 ...[...database.matchAll(/^node (tests\/[^\s]+\.mjs)$/gm)].map(match => match[1]),
]);
if (/^npx supabase test db$/m.test(database)) {
 // Supabase's pg_prove invocation searches recursively for both extensions.
 for (const path of [...globSync('supabase/tests/**/*.sql'), ...globSync('supabase/tests/**/*.pg')]) covered.add(path);
}

// Playwright collects files with its real config, including testIgnore and testDir. The production-shaped suite has its own config.
for (const config of readdirSync('.').filter(name => /^playwright(\.[a-z]+)?\.config\.[cm]?[jt]s$/.test(name)).sort()) {
 const browser = JSON.parse(execFileSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '-c', config, '--list', '--reporter=json', '--pass-with-no-tests',
 ], { encoding: 'utf8' }));
 function browserFiles(suites) {
  for (const suite of suites) {
   if (suite.file) covered.add(resolve(browser.config.rootDir, suite.file));
   browserFiles(suite.suites ?? []);
  }
 }
 browserFiles(browser.suites);
}

// Playwright's approved images (`<spec>-snapshots/`) are data for a spec, not tests.
const approvedImage = path => /(^|\/)[^/]+-snapshots\//.test(path);
const orphans = files().filter(path =>
 !approvedImage(path) &&
 (/(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.[^/]+$/.test(path) || path.endsWith('.verify.sql')) &&
 !helpers.has(path) && !covered.has(path) && !covered.has(resolve(path))
).sort();
for (const path of orphans) console.error(`No runner discovers: ${path}`);
console.log(`Test discovery: ${orphans.length} orphan(s)`);
process.exitCode = orphans.length ? 1 : 0;
