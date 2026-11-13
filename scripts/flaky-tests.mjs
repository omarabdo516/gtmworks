// Lists the Playwright tests that failed and then passed on their CI retry (#158).
// Pure functions first (unit tests in tests/flaky-tests.test.mjs); the command line at the bottom does the file work.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { reportState } from './playwright-journal.mjs';

export const ISSUE_TITLE_PREFIX = 'Flaky test: ';
const ANSI = /\u001b\[[0-9;]*m/g;

// First non-empty line of the first failed attempt's error.
function errorLine(test) {
  const failed = (test.results ?? []).find((r) => r.status === 'failed' || r.status === 'timedOut');
  const message = failed?.error?.message ?? failed?.errors?.[0]?.message ?? '';
  return message.replace(ANSI, '').split('\n').map((l) => l.trim()).find(Boolean) ?? 'no error message recorded';
}

// One entry per test title (file and title path, no project), however many projects or reports repeat it.
// Only status "flaky" counts: a test that stayed red ("unexpected") is a hard failure, never flaky.
export function flakyTests(report) {
  const found = new Map();
  const walk = (suite, titles) => {
    const path = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== 'flaky') continue;
        const title = [spec.file ?? suite.file, ...path, spec.title].filter(Boolean).join(' › ');
        const entry = found.get(title);
        if (entry) { entry.occurrences += 1; if (test.projectName && !entry.projects.includes(test.projectName)) entry.projects.push(test.projectName); }
        else found.set(title, { title, projects: test.projectName ? [test.projectName] : [], occurrences: 1, error: errorLine(test) });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const suite of report?.suites ?? []) walk(suite, []);
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// incomplete: Playwright stopped before it finished (scripts/playwright-journal.mjs), so nothing is said about the run's result.
const STOPPED = 'Playwright stopped before it finished in that run, so this covers only the cases it observed and says nothing about the run\'s result.';

export function renderSummary(flaky, runUrl, { incomplete = false } = {}) {
  if (!flaky.length) return '';
  const lines = ['## Flaky tests', '', `These tests failed, then passed on their one retry. ${incomplete ? STOPPED : 'The run stays green.'} Run: ${runUrl}`, ''];
  for (const t of flaky) lines.push(`- ${t.title}: ${t.error}`);
  return lines.join('\n') + '\n';
}

export const issueTitle = (flakyTest) => `${ISSUE_TITLE_PREFIX}${flakyTest.title}`;

export function issueBody(flakyTest, runUrl, { incomplete = false } = {}) {
  return [`Run: ${runUrl}`, '', `First failure's error line: ${flakyTest.error}`, '', incomplete ? `It failed, then passed on its one CI retry. ${STOPPED}` : 'It failed, then passed on its one CI retry, so the run stayed green.'].join('\n') + '\n';
}

function readReport(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// node scripts/flaky-tests.mjs <report.json> <run-url> <out.json>
// Appends the listing to $GITHUB_STEP_SUMMARY and writes the flaky tests (with their issue title and body) to <out.json>.
// Exits non-zero only on its own errors (a missing argument); a red test never changes the exit code.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reportPath, runUrl = '', outPath = 'flaky.json'] = process.argv.slice(2);
  if (!reportPath) { console.error('usage: flaky-tests.mjs <report.json> <run-url> <out.json>'); process.exit(2); }
  const report = readReport(reportPath);
  const options = { incomplete: reportState(report) === 'interrupted' };
  const flaky = flakyTests(report);
  writeFileSync(outPath, JSON.stringify(flaky.map((t) => ({ ...t, issueTitle: issueTitle(t), issueBody: issueBody(t, runUrl, options) })), null, 2));
  const summary = renderSummary(flaky, runUrl, options);
  if (summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary || 'No flaky tests.');
}
