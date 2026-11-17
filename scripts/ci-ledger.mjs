import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classify, failedStep } from './ci-classify.mjs';

// The CI ledger (#256): one record for the run, one per job and one per test, and the job summary's table. It reports
// and never decides: the verdict stays with `check` (scripts/ci-verdict.mjs).

// Seconds, reported only (spec #255 D16). `changes` has no budget.
export const budgets = {
  layers: { fast: 90, database: 180, visual: 300, integration: { 'self-hosted': 480, 'github-hosted': 720 }, install: 720, lane: 420 },
  run: { pull_request: 600, otherwise: 840 },
};
export const layers = ['changes', 'fast', 'database', 'visual', 'integration', 'install', 'lane'];

function budgetOf(layer, environment) {
  const budget = budgets.layers[layer];
  if (typeof budget === 'object') return environment === 'self-hosted' ? budget['self-hosted'] : budget['github-hosted'];
  return budget ?? null;
}

export const layerOf = jobName => jobName.replace(/ \(.*\)$/, '');
const shardOf = jobName => jobName.match(/ \((\d+\/\d+)\)$/)?.[1] ?? '';

// Which `changes` output each layer follows; the compared screens follow the browser suite's.
const decisionOf = { database: 'database', visual: 'integration', integration: 'integration', install: 'install', lane: 'integration' };
const e2eOff = 'manual run: the e2e input is off';
const mainOnly = 'compared screens run on main and manual runs only (#257)';
// [decision, event, layer, reason]; `*` matches any. The first matching row wins.
const skipReasons = [
  ['*', 'pull_request', 'visual', mainOnly],
  ['*', 'pull_request', 'lane', mainOnly],
  ['false', 'pull_request', '*', 'no changed file is in its area (scripts/ci-areas.mjs)'],
  ['false', 'push', '*', 'every changed file is a document'],
  ['false', 'workflow_dispatch', 'integration', e2eOff],
  ['false', 'workflow_dispatch', 'install', 'manual run: the install input is off'],
];
const notStarted = 'not started: the run was cancelled or a job it needs did not succeed';

export function skipReason(layer, decisions, event) {
  const decision = decisions[decisionOf[layer]];
  const row = skipReasons.find(([d, e, l]) => (d === '*' || d === decision) && (e === '*' || e === event) && (l === '*' || l === layer));
  return row?.[3] ?? notStarted;
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const readLines = path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

function vitest(report, root) {
  const outcomes = { passed: 'passed', failed: 'failed' };
  return report.testResults.flatMap(file => file.assertionResults.map(test => ({
    suite: 'vitest', file: relative(root, file.name), name: test.fullName, duration_ms: test.duration ?? 0,
    outcome: outcomes[test.status] ?? 'skipped', retries: 0, lane: null,
  })));
}

function playwright(report) {
  // Spec files are named from the config's own folder, so a record reads the same whichever machine ran it.
  const base = report.config?.configFile ? dirname(report.config.configFile) : process.cwd();
  const root = report.config?.rootDir ?? base;
  const outcome = test => {
    if (test.status === 'expected') return test.results.length && test.results.every(result => result.status === 'skipped') ? 'skipped' : 'passed';
    return { unexpected: 'failed', flaky: 'flaky' }[test.status] ?? 'skipped';
  };
  const walk = (suites, titles, top) => (suites ?? []).flatMap(suite => {
    const path = top ? titles : [...titles, suite.title];
    return [
      ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({
        suite: 'playwright', file: relative(base, resolve(root, spec.file)),
        name: `${test.projectName ? `[${test.projectName}] ` : ''}${[...path, spec.title].join(' › ')}`,
        duration_ms: test.results.reduce((sum, result) => sum + result.duration, 0), outcome: outcome(test),
        retries: Math.max(0, test.results.length - 1), lane: test.results.at(-1)?.parallelIndex ?? null,
      }))),
      ...walk(suite.suites, path, false),
    ];
  });
  return walk(report.suites, [], true);
}

// One job's folder: meta.json and whatever results its stage wrote (ci.sh `ledger_dir`).
export function testRecords(folder) {
  const meta = readJson(join(folder, 'meta.json'));
  const root = meta.root ?? process.cwd();
  const tests = [];
  const unreadable = [];
  for (const name of readdirSync(folder).sort()) {
    if (name === 'meta.json') continue;
    const path = join(folder, name);
    try {
      if (name === 'node.jsonl' || name === 'database.jsonl') tests.push(...readLines(path).map(record => ({ lane: null, ...record })));
      else if (name === 'vitest.json') tests.push(...vitest(readJson(path), root));
      else if (name.endsWith('.json')) tests.push(...playwright(readJson(path)));
    } catch {
      unreadable.push(path);
    }
  }
  const { layer, shard = '', runner = null, environment = null } = meta;
  return { tests: tests.map(test => ({ kind: 'test', layer, shard, ...test, runner, environment })), unreadable };
}

const seconds = (from, to) => (from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000) : null);

function jobRecord(job, { run_id, attempt, event, decisions, log }) {
  const layer = layerOf(job.name);
  const environment = job.runner_name ? (job.runner_group_name === 'GitHub Actions' ? 'github-hosted' : 'self-hosted') : null;
  let classification = null;
  if (job.conclusion === 'failure') classification = log == null ? { label: 'unknown', cause: null, evidence: null } : classify(log, { failedStep: failedStep(job.steps) });
  return {
    kind: 'job', run_id, attempt, layer, name: job.name, conclusion: job.conclusion, created_at: job.created_at,
    started_at: job.started_at, completed_at: job.completed_at, duration_s: seconds(job.started_at, job.completed_at),
    queue_s: seconds(job.created_at, job.started_at), runner: job.runner_name || null, environment,
    budget_s: budgetOf(layer, environment), skip_reason: job.conclusion === 'skipped' ? skipReason(layer, decisions, event) : null,
    classification, steps: (job.steps ?? []).map(step => ({ name: step.name, conclusion: step.conclusion, duration_s: seconds(step.started_at, step.completed_at) })),
  };
}

const minutes = value => (value == null ? '—' : `${(value / 60).toFixed(1)} min`);
const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const outcomes = ['passed', 'flaky', 'failed', 'skipped'];

function counts(tests) {
  const parts = outcomes.map(outcome => [outcome, tests.filter(test => test.outcome === outcome).length]).filter(([, n]) => n);
  return parts.length ? parts.map(([outcome, n]) => `${n} ${outcome}`).join(', ') : '—';
}

function note(job) {
  if (job.skip_reason) return job.skip_reason;
  const found = job.classification;
  if (!found) return '';
  if (found.label === 'unknown') return 'log unavailable';
  if (found.label !== 'infrastructure') return found.label;
  return `infrastructure: ${found.cause}: \`${String(found.evidence).replaceAll('`', "'")}\``;
}

export function summary({ run, jobs, tests, unreadable = [] }) {
  const shown = jobs.filter(job => layers.includes(job.layer))
    .sort((a, b) => layers.indexOf(a.layer) - layers.indexOf(b.layer) || a.name.localeCompare(b.name));
  const rows = shown.map(job => {
    const own = tests.filter(test => test.layer === job.layer && test.shard === shardOf(job.name));
    const over = job.budget_s != null && job.duration_s > job.budget_s ? ' (over)' : '';
    const ran = job.conclusion !== 'skipped';
    return `| ${[job.name, job.conclusion ?? 'unfinished', ran ? minutes(job.duration_s) + over : '—', minutes(job.budget_s),
      ran ? minutes(job.queue_s) : '—', job.runner ?? '—', counts(own), note(job)].map(cell).join(' | ')} |`;
  });
  const suites = [...new Set(tests.map(test => test.suite))].sort();
  const records = suites.length ? suites.map(suite => `${suite} ${tests.filter(test => test.suite === suite).length}`).join(', ') : 'none';
  const over = run.budget_s != null && run.wall_s > run.budget_s ? ' (over)' : '';
  return [
    '## CI ledger', '',
    '| Layer | Result | Duration | Budget | Queue | Runner | Tests | Note |',
    '|---|---|---|---|---|---|---|---|',
    ...rows, '',
    `Whole run: ${minutes(run.wall_s)}${over} against a budget of ${minutes(run.budget_s)}. Budgets are reported, not enforced.`, '',
    `Test records: ${records}.`,
    ...unreadable.map(path => `\nunreadable results: ${path}`),
  ].join('\n') + '\n';
}

function folders(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return entry.name === 'meta.json' ? [directory] : [];
    return folders(join(directory, entry.name));
  });
}

async function main([input, output]) {
  const env = process.env;
  if (!input || !output) throw new Error('usage: node scripts/ci-ledger.mjs <downloaded folder> <out folder>');
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  const request = url => fetch(url, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  const get = async url => {
    const response = await request(url);
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${new URL(url).pathname}`);
    return response;
  };
  const run_id = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const event = env.EVENT_NAME;
  const run = await (await get(`${base}/actions/runs/${run_id}`)).json();
  const listed = [];
  for (let url = `${base}/actions/runs/${run_id}/attempts/${attempt}/jobs?per_page=100`; url;) {
    const response = await get(url);
    listed.push(...(await response.json()).jobs);
    url = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  const decisions = Object.fromEntries(['database', 'integration', 'install'].map(name => [name, env[`DECISIONS_${name.toUpperCase()}`] ?? '']));
  const jobs = [];
  for (const job of listed.filter(job => job.name !== env.GITHUB_JOB && job.name !== 'check')) {
    let log;
    if (job.conclusion === 'failure') {
      const response = await request(`${base}/actions/jobs/${job.id}/logs`).catch(() => null);
      log = response?.ok ? await response.text() : null;
    }
    jobs.push(jobRecord(job, { run_id, attempt, event, decisions, log }));
  }
  const tests = [];
  const unreadable = [];
  for (const folder of folders(input).sort()) {
    try {
      const found = testRecords(folder);
      tests.push(...found.tests.map(test => ({ kind: 'test', run_id, attempt, ...test })));
      unreadable.push(...found.unreadable.map(path => relative(input, path)));
    } catch {
      unreadable.push(relative(input, join(folder, 'meta.json')));
    }
  }
  const ends = jobs.map(job => job.completed_at).filter(Boolean).sort();
  const pullRequest = Number(env.PR_NUMBER) || null;
  const record = {
    kind: 'run', run_id, attempt, event, ref: run.head_branch, sha: run.head_sha, pull_request: pullRequest,
    created_at: run.created_at, wall_s: seconds(run.run_started_at ?? run.created_at, ends.at(-1)),
    budget_s: event === 'pull_request' ? budgets.run.pull_request : budgets.run.otherwise,
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'ledger.jsonl'), [record, ...jobs, ...tests].map(line => JSON.stringify(line)).join('\n') + '\n');
  process.stdout.write(summary({ run: record, jobs, tests, unreadable }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`CI ledger unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
