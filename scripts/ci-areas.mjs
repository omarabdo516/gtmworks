import { readFileSync } from 'node:fs';

// Which long suites a change needs (#76), as Hermes `detect` and T3 Code `Changes` decide it: each suite runs only when
// the files it covers changed. Static (lint, types, catalogues, the node unit tests) runs on every change and needs no
// entry here. Prints components=, database=, integration= and install= lines for $GITHUB_OUTPUT. With --main (a push to main) every
// suite runs unless every file is a document. Accepts path arguments or git diff --name-only -z on stdin; an empty,
// malformed or unreadable list runs every suite.
const everything = [/^\.github\/workflows\/ci\.yml$/, /^ci\.sh$/, /^scripts\/ci-(areas|verdict)\.mjs$/, /^package(-lock)?\.json$/];
const suites = {
  // Screens as components in headless Chromium (vitest.config.mts, #81): the app's screens and components, the library
  // they import (catalogues included), and the component tests and their config.
  components: [/^(app|components|lib)\//, /^tests\/components\//, /^vitest\.config\.mts$/],
  // The database tests: migrations replayed and verified, RLS and grants (tests/db.sh, *.verify.sql, check-rls.sql).
  database: [
    /^supabase\//, /^scripts\/(check-rls\.sql|verify-db\.mjs|local-db\.sh|local-default-privileges\.sql|bootstrap-owner\.mjs)$/,
    /^tests\/(db\.sh|[^/]*-migration\.mjs|bootstrap-db\.mjs|hosted-default-privileges\.mjs|agent-role-backfill\.mjs|sql-statements\.mjs)$/,
  ],
  // The whole-app browser suite and its screens: the specs, their helpers and approved images, the stacks they run on
  // (every lane is built from the migrations, the stack configuration and the local default privileges), the first-run
  // reset helpers the specs import, the image the job builds and the proxy suite runs in, the seed the screens are
  // compared on, and public/ (a browser test reads every file there). Until screens have
  // component tests (#81), it is also what proves app code before merge, so the app, its library, the worker and the
  // root files the build and server read run it too (review run on #79).
  integration: [
    /^(app|components|lib|worker)\//, /^(middleware|instrumentation)\.ts$/, /^(next|postcss)\.config\.mjs$/, /^server\.js$/,
    /^tests\/(.+\/)?[^/]+\.spec\.ts$/, /^tests\/[^/]+\.ts$/, /^tests\/visual\.spec\.ts-snapshots\//,
    /^tests\/(visual-screens|lane|fake-hermes|fake-engine|touch-diagnostics|motion-table|motion-css)\.mjs$/, /^tests\/visual-screens\//,
    /^playwright(\.proxy)?\.config\.ts$/, /^Dockerfile$/, /^\.dockerignore$/,
    /^scripts\/(web\.sh|local-db\.sh|proxy-stack\.sh|ci-image\.sh|first-run-db\.mjs|local-default-privileges\.sql)$/,
    /^supabase\/(migrations\/|config\.toml$|seed\.sql$)/, /^public\//,
  ],
  // The Docker install, update, backup and release: the image and its build inputs, the install and release files, the
  // migrations it applies and the checks it runs, and the code those checks drive against the real bundled Hermes (lib/,
  // worker/, the server the image runs; the browser suite only has fake engines). Screens alone run it on main.
  install: [
    /^(lib|worker)\//, /^next\.config\.mjs$/, /^server\.js$/,
    /^Dockerfile$/, /^\.dockerignore$/, /^docker-compose[^/]*\.ya?ml$/, /^\.env[^/]*\.example$/,
    /^scripts\/(install|check-install|get\.sh$|release-assets\.mjs$|check-hermes-keys\.py$|check-rls\.sql$|verify-db\.mjs$|forged-identity\.mjs$|local-default-privileges\.sql$)/,
    /^supabase\//, /^playwright\.install\.config\.ts$/, /^tests\/install\//, /^\.github\/workflows\/release[^/]*\.ya?ml$/,
  ],
};
const isDocument = path => !path.startsWith('public/') && (path.startsWith('design/') || path.startsWith('docs/') || path.endsWith('.md'));
const main = process.argv[2] === '--main';
const args = process.argv.slice(main ? 3 : 2);
let paths = null;
try {
  paths = args.length > 0 ? args : readFileSync(0, 'utf8').replace(/\0$/, '').split('\0');
  if (paths.length === 0 || !paths.every(path => path.split('/').every(part => part && part !== '.' && part !== '..'))) paths = null;
} catch {
  // An unreadable list runs every suite.
}
for (const [suite, patterns] of Object.entries(suites)) {
  const runs = paths === null
    || (main ? !paths.every(isDocument) : paths.some(path => [...everything, ...patterns].some(pattern => pattern.test(path))));
  console.log(`${suite}=${runs}`);
}
