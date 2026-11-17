import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The compared screens run on main only (#257, Omar 2026-11-17). When they fail there, the visual job opens or updates
// one issue labelled visual-regression with this text: each failed screen, the commit, the run and the difference images.
// Usage: node scripts/visual-regression.mjs <folder of Playwright JSON reports> <sha> <run url> <artifact url>

/** Every failed test of a Playwright JSON report, as "<describe> › <title> (<file>:<line>)". */
export function failedTests(report) {
  const failed = [];
  const walk = (suite, path) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) if (!spec.ok) failed.push(`${[...here, spec.title].join(' › ')} (${suite.file}:${spec.line})`);
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return failed;
}

export function regressionIssue({ failed, sha, runUrl, artifactUrl }) {
  const lines = [`The compared screens failed on main at ${sha} ([run](${runUrl})).`, ''];
  if (failed.length) lines.push('These screens differ from their approved images:', ...failed.map(name => `- ${name}`));
  else lines.push('No screen comparison failed: the run failed before or around them. Read the run.');
  lines.push('', artifactUrl ? `Expected, actual and difference images: ${artifactUrl}` : 'The run uploaded no difference images.');
  lines.push('', 'No pull request waits for this. When the change was intended, refresh the approved images in a pull request.');
  return { title: 'Compared screens differ on main', body: lines.join('\n') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [folder, sha, runUrl, artifactUrl = ''] = process.argv.slice(2);
  const failed = [];
  for (const name of readdirSync(folder).filter(name => name.endsWith('.json') && name !== 'meta.json')) {
    try { failed.push(...failedTests(JSON.parse(readFileSync(join(folder, name), 'utf8')))); } catch { /* an unreadable report names no screen */ }
  }
  console.log(regressionIssue({ failed, sha, runUrl, artifactUrl }).body);
}
