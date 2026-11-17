import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The compared screens run on main only (#257, Omar 2026-11-17). When the visual job fails there, it opens or updates one
// issue labelled visual-regression with this text: each picture that differs, each lane check (a guard, a contrast
// measure) and each navigation budget that failed, the commit, the run and the difference images.
// Usage: node scripts/visual-regression.mjs [--title] <ledger folder> <sha> <run url> <artifact url>

/** Every failed test of a Playwright JSON report: its name, and whether it failed on a picture (one that differs or has no
 * approved image yet). */
export function failures(report) {
  const failed = [];
  const walk = (suite, path) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) if (!spec.ok) {
      const messages = (spec.tests ?? []).flatMap(test => (test.results ?? []).map(result => result.error?.message ?? ''));
      failed.push({ name: `${[...here, spec.title].join(' › ')} (${suite.file}:${spec.line})`, screen: messages.some(message => message.includes('toHaveScreenshot') || message.includes("snapshot doesn't exist")) });
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return failed;
}

export function regressionIssue({ screens, checks, budgets, sha, runUrl, artifactUrl }) {
  const lines = [`The visual job failed on main at ${sha} ([run](${runUrl})).`];
  const section = (heading, names) => { if (names.length) lines.push('', heading, ...names.map(name => `- ${name}`)); };
  section('These screens differ from their approved images:', screens);
  section('These lane checks failed (guards, contrast):', checks);
  section('These navigation budgets failed:', budgets);
  if (!screens.length && !checks.length && !budgets.length) lines.push('', 'Nothing was compared: the run failed before or around the tests. Read the run.');
  lines.push('', artifactUrl ? `Expected, actual and difference images: ${artifactUrl}` : 'The run uploaded no difference images.');
  lines.push('', 'No pull request waits for this. When a picture changed on purpose, refresh the approved images in a pull request.');
  return { title: screens.length ? 'Compared screens differ on main' : 'The visual job failed on main', body: lines.join('\n') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const titleOnly = args[0] === '--title';
  const [folder, sha, runUrl, artifactUrl = ''] = titleOnly ? args.slice(1) : args;
  const found = { screens: [], checks: [], budgets: [] };
  // A run that stopped before its tests (the renderer, the stack) wrote no report, and still gets its issue.
  for (const name of (existsSync(folder) ? readdirSync(folder) : []).filter(name => name.endsWith('.json') && name !== 'meta.json')) {
    let failed = [];
    try { failed = failures(JSON.parse(readFileSync(join(folder, name), 'utf8'))); } catch { /* an unreadable report names nothing */ }
    // ci.sh visual writes the navigation budgets to measured.json beside the lane's report.
    for (const { name: test, screen } of failed) (name === 'measured.json' ? found.budgets : screen ? found.screens : found.checks).push(test);
  }
  const issue = regressionIssue({ ...found, sha, runUrl, artifactUrl });
  console.log(titleOnly ? issue.title : issue.body);
}
