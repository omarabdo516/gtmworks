// Names the failing Playwright tests of a PR run that are already red on main (#157).
// Pure functions first (unit tests in tests/compare-failures.test.mjs); the command line at the bottom does the file work.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { otherInvocations, reportState, withoutFinalOutcome } from './playwright-journal.mjs';

export const COMMENT_MARKER = '<!-- ci-main-failures -->';

// Every test of a Playwright JSON report that finished red, as a stable name: project, file and the full title path.
export function failedTests(report) {
  const names = new Set();
  const walk = (suite, titles) => {
    const path = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const red = test.status === 'unexpected' || (!test.status && (test.results ?? []).some((r) => r.status === 'failed' || r.status === 'timedOut'));
        if (red) names.add([test.projectName, spec.file ?? suite.file, ...path, spec.title].filter(Boolean).join(' › '));
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const suite of report?.suites ?? []) walk(suite, []);
  return [...names].sort();
}

// pr, main: parsed reports; main is null when the main run saved no report. A renamed test has a new name, so it counts as the PR's own.
// A report from a run that stopped early (scripts/playwright-journal.mjs) lists only the failures it observed: it is named
// incomplete, and a test missing from it proves nothing. So against an incomplete main, a PR failure main never showed
// is unknown on main, never the PR's own.
export function compareFailures(pr, main) {
  const prFailures = failedTests(pr);
  if (reportState(pr) === 'not-started') {
    const others = otherInvocations(pr);
    return others.length ? { prMainNotStarted: true, prOtherInvocations: others, mainReport: false, inherited: [], own: [] } : { prNotRun: true, mainReport: false, inherited: [], own: [] };
  }
  const prMain = pr?.execution?.invocations?.main;
  const prIncomplete = reportState(pr) === 'interrupted' ? { prIncomplete: true, prSelected: prMain.selected, prUnknown: prMain.unknown, prUnrecorded: prMain.unrecordedSelected ?? null } : {};
  if (!main || reportState(main) === 'not-started') return { mainReport: false, inherited: [], own: prFailures, ...prIncomplete };
  const onMain = new Set(failedTests(main));
  const unmatched = prFailures.filter((name) => !onMain.has(name));
  const mainIncomplete = reportState(main) === 'interrupted';
  return {
    mainReport: true,
    ...(mainIncomplete ? { mainIncomplete: true, unknownOnMain: unmatched } : {}),
    inherited: prFailures.filter((name) => onMain.has(name)),
    own: mainIncomplete ? [] : unmatched,
    ...prIncomplete,
  };
}

const list = (names) => names.map((name) => `- ${name}`).join('\n');

export function renderMarkdown(result, mainRunUrl) {
  const { inherited, own, unknownOnMain, mainReport, mainIncomplete, prNotRun, prMainNotStarted, prOtherInvocations, prIncomplete, prSelected, prUnknown, prUnrecorded } = result;
  const lines = ['## Failing tests'];
  if (prNotRun) {
    lines.push('', 'Playwright did not run in this CI run: an earlier step failed. No test failed and none passed here; fix that step first.');
    return lines.join('\n') + '\n';
  }
  if (prMainNotStarted) {
    lines.push('', 'The main Playwright suite did not start in this CI run, so it has no outcome here. Another Playwright invocation did run first; execution.json in the playwright-report artifact holds its record:', '', list(prOtherInvocations));
    return lines.join('\n') + '\n';
  }
  if (prIncomplete) {
    // Known identities without an outcome (interrupted, awaiting a retry, never started) are kept apart from selected
    // cases whose identity was never written; before selection the count itself is unknown.
    const unknown = withoutFinalOutcome({ unknown: prUnknown, unrecordedSelected: prUnrecorded });
    const of = prSelected === null ? 'The selected cases are unknown' : `${unknown} of ${prSelected} selected cases have no final outcome`;
    const unrecorded = prUnrecorded === null ? '' : `, ${prUnrecorded} selected but never recorded by name`;
    lines.push('', `Playwright stopped before it finished in this CI run. ${of} (${prUnknown.interrupted} interrupted, ${prUnknown.retryPending} awaiting a retry, ${prUnknown.notStarted} never started${unrecorded}; execution.json in the playwright-report artifact names the recorded ones). Only the failures it observed are listed; a test missing from them is not shown to pass.`);
  }
  if (!mainReport) lines.push('', `The latest completed run on main saved no usable Playwright report${mainRunUrl ? ` (${mainRunUrl})` : ''}, so nothing can be named as inherited. All failures are listed as this PR\'s own.`);
  else if (mainIncomplete) lines.push('', `The latest completed run on main stopped before Playwright finished (${mainRunUrl}): only the failures it observed can be named as inherited, and the rest are unknown on main.`);
  else lines.push('', `Compared with the latest completed run on main: ${mainRunUrl}`);
  lines.push('', `### Inherited from main (${inherited.length})`, '', inherited.length ? list(inherited) : 'None.');
  if (mainIncomplete) lines.push('', `### Unknown on main (${unknownOnMain.length})`, '', 'The run on main stopped before these had an outcome there, so they are neither inherited nor shown to be this PR\'s own.', '', unknownOnMain.length ? list(unknownOnMain) : 'None.');
  lines.push('', `### This PR's own (${own.length})`, '', own.length ? list(own) : 'None.');
  return lines.join('\n') + '\n';
}

function readReport(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// node scripts/compare-failures.mjs <pr-report.json> <main-report.json|-> <main-run-url> <comment-out.md>
// Appends to $GITHUB_STEP_SUMMARY; writes the comment body only when the PR has failing tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [prPath, mainPath, mainRunUrl = '', commentPath = 'comment.md'] = process.argv.slice(2);
  const pr = readReport(prPath);
  if (!pr) { console.log('No Playwright report for this run; nothing to compare.'); process.exit(0); }
  const result = compareFailures(pr, readReport(mainPath));
  if (!result.prNotRun && !result.prMainNotStarted && !result.prIncomplete && !result.inherited.length && !result.own.length && !result.unknownOnMain?.length) { console.log('No failing Playwright tests; nothing to post.'); process.exit(0); }
  const body = renderMarkdown(result, mainRunUrl);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  writeFileSync(commentPath, `${COMMENT_MARKER}\n${body}`);
  console.log(body);
}
