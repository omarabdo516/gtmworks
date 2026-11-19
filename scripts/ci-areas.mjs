import { readFileSync } from 'node:fs';

// Which long suites a change needs (#76), as Hermes `detect` and T3 Code `Changes` decide it: each suite runs only when
// the files it covers changed. Static (lint, types, catalogues, the node unit tests) runs on every change and needs no
// entry here. Prints components=, database=, integration= and install= lines for $GITHUB_OUTPUT. Each suite prints the
// first of its levels whose files changed, or false. The compared screens are not here: they run on main only, never on
// a pull request (#257). With --main (a push to main) every suite runs unless every file is a document.
// Accepts path arguments or git diff --name-only -z on stdin; an empty, malformed or unreadable list runs every suite.
const everything = [/^\.github\/workflows\/ci\.yml$/, /^ci\.sh$/, /^scripts\/ci-(areas|verdict|runner|fast)\.mjs$/, /^package(-lock)?\.json$/];
const suites = {
  // Screens as components in headless Chromium (vitest.config.mts, #81): the app's screens and components, the library
  // they import (catalogues included), and the component tests and their config. The motion test (#127) also reads the
  // reference and the motion table through the motion reader, at the motion table's widths and languages, with the
  // stylesheets built through PostCSS. The offline guard (tests/offline.mjs, #266) is loaded by both test configs.
  components: { true: [
    /^(app|components|lib)\//, /^tests\/components\//, /^vitest\.config\.mts$/,
    /^tests\/(motion-table|motion-css|offline)\.mjs$/, /^design-reference\/index\.html$/, /^postcss\.config\.mjs$/,
  ] },
  // The database tests: migrations replayed and verified, RLS and grants (tests/db.sh, *.verify.sql, check-rls.sql).
  database: {
    true: [
      /^supabase\//,
      /^scripts\/(check-rls\.sql|verify-db(-session)?\.mjs|local-db\.sh|local-default-privileges\.sql|bootstrap-owner\.mjs|supabase-images\.sh)$/,
      /^tests\/(db\.sh|pgtap\.mjs|verify-db-session-canary\.sql|[^/]*-migration\.mjs|bootstrap-db\.mjs|hosted-default-privileges\.mjs|agent-role-backfill\.mjs|sql-statements\.mjs)$/,
    ],
  },
  integration: {
    // The whole-app browser suite: the proxy suite, the image and the journeys (functional,
    // measured, first run). Its own area: the specs and their helpers, the Playwright configs, the stacks they run on
    // (every lane is built from the migrations, the stack configuration and the local default privileges), the first-run
    // reset helpers the specs import, the image the job builds and the proxy suite runs in, the seed, public/ (the app
    // serves every file there), and the code the journeys drive with no component test: server code under app/
    // (route handlers and server actions, where the server checks permissions), lib/ outside the catalogues, the worker
    // and the root files the build and server read.
    true: [
      /^app\/.+\.ts$/, /^lib\/(?!messages\/)/, /^worker\//, /^(middleware|instrumentation)\.ts$/, /^(next|postcss)\.config\.mjs$/,
      /^server\.js$/, /^tests\/(?!visual-lane)(.+\/)?[^/]+\.spec\.ts$/, /^tests\/(?!visual-lane)[^/]+\.ts$/,
      /^tests\/(lane|fake-hermes|fake-engine|offline)\.mjs$/,
      /^playwright(\.proxy)?\.config\.ts$/, /^Dockerfile$/, /^\.dockerignore$/,
      /^scripts\/(web\.sh|local-db\.sh|proxy-stack\.sh|ci-image\.sh|first-run-db\.mjs|local-default-privileges\.sql|supabase-images\.sh)$/,
      /^supabase\/(migrations\/|config\.toml$|seed\.sql$)/, /^public\//,
    ],
  },
  // The Docker install, update, backup and release: the image and its build inputs, the install and release files, the
  // migrations it applies and the checks it runs, and the code those checks drive against the real bundled Hermes (lib/
  // outside the catalogues, worker/, the server the image runs; the browser suite only has fake engines). Screens and
  // their catalogues alone run it on main.
  install: {
    true: [
      /^lib\/(?!messages\/)/, /^worker\//, /^next\.config\.mjs$/, /^server\.js$/,
      /^Dockerfile$/, /^\.dockerignore$/, /^docker-compose[^/]*\.ya?ml$/, /^\.env[^/]*\.example$/,
      /^scripts\/(install|check-install|get\.sh$|release-assets\.mjs$|check-hermes-keys\.py$|check-rls\.sql$|verify-db\.mjs$|forged-identity\.mjs$|local-default-privileges\.sql$|ci-install-(check|lib)\.sh$|ci-install-points\.txt$|engine-template\.yml$|company-[a-z]+\.mjs$|install-engine\.mjs$)/,
      // The install job's profile proof (#126) and its unit test: a change to what it proves runs it.
      /^scripts\/check-install-profiles\.mjs$/, /^tests\/check-install-profiles\.test\.mjs$/,
      /^supabase\//, /^playwright\.install\.config\.ts$/, /^tests\/install\//, /^\.github\/workflows\/release[^/]*\.ya?ml$/,
    ],
  },
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
const touches = patterns => paths.some(path => patterns.some(pattern => pattern.test(path)));
for (const [suite, levels] of Object.entries(suites)) {
  const runs = paths === null
    || (main ? !paths.every(isDocument) : touches(everything) || (Object.keys(levels).find(level => touches(levels[level])) ?? false));
  console.log(`${suite}=${runs}`);
}
