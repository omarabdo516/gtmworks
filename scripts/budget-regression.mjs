import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The measured navigation budgets run on main and on a manual run only (#224, #805). When the `budgets` job fails on a push
// to main, it opens or updates one issue labelled budget-regression with this text: each budget that failed, the commit
// and the run.
// Usage: node scripts/budget-regression.mjs [--title] <Playwright JSON report> <sha> <run url>

/** The name of every failed test of a Playwright JSON report, with its file and line. */
export function failures(report) {
  const failed = [];
  const walk = (suite, path) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) if (!spec.ok) failed.push(`${[...here, spec.title].join(' › ')} (${suite.file}:${spec.line})`);
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return failed;
}

/** `budgets` is null when the run wrote no report it could read. */
export function regressionIssue({ budgets, sha, runUrl }) {
  const lines = [`The navigation budgets failed on main at ${sha} ([run](${runUrl})).`, ''];
  if (budgets?.length) lines.push('These budgets failed:', ...budgets.map(name => `- ${name}`));
  else if (budgets) lines.push('Every budget measured passed: the run failed around the tests. Read the run.');
  else lines.push('No budget was measured: the run failed before the tests wrote their report. Read the run.');
  lines.push('', 'No pull request waits for this.');
  return { title: 'The navigation budgets failed on main', body: lines.join('\n') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const titleOnly = args[0] === '--title';
  const [file, sha, runUrl] = titleOnly ? args.slice(1) : args;
  // A run that stopped before its tests (the stack, the build) wrote no report, and still gets its issue.
  let budgets = null;
  try { if (existsSync(file)) budgets = failures(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* an unreadable report is no report */ }
  const issue = regressionIssue({ budgets, sha, runUrl });
  console.log(titleOnly ? issue.title : issue.body);
}
