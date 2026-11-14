import { readFileSync } from 'node:fs';

// Prints true when a pull request changes a file the install job exercises (#69): the image and its build inputs, the
// install and release files, the database, the code the install checks import (lib/, worker/), and the workflows.
// App screens, components and the browser suite are proven by the integration job; main always runs the install job.
// Accepts path arguments or git diff --name-only -z on stdin. An empty or unreadable list runs the install job.
const related = [
  /^Dockerfile$/, /^\.dockerignore$/, /^docker-compose[^/]*\.ya?ml$/, /^\.env[^/]*\.example$/,
  /^package(-lock)?\.json$/, /^next\.config\.mjs$/, /^server\.js$/,
  /^scripts\/(install|check-install|get\.sh$|release-assets\.mjs$|check-hermes-keys\.py$|check-rls\.sql$|verify-db\.mjs$|forged-identity\.mjs$|local-default-privileges\.sql$)/,
  /^supabase\//, /^lib\//, /^worker\//,
  /^playwright\.install\.config\.ts$/, /^tests\/install\//,
  /^\.github\/workflows\/(ci|release[^/]*)\.ya?ml$/,
];
let install = true;
try {
  const paths = process.argv.length > 2 ? process.argv.slice(2) : readFileSync(0, 'utf8').replace(/\0$/, '').split('\0');
  const wellFormed = paths.length > 0 && paths.every(path => path.split('/').every(part => part && part !== '.' && part !== '..'));
  install = !wellFormed || paths.some(path => related.some(pattern => pattern.test(path)));
} catch {
  // An unreadable list runs the install job.
}
console.log(install);
