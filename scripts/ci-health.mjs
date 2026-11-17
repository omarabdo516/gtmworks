import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layers } from './ci-ledger.mjs';

// The nightly CI health report (#256): the last days of ledgers (scripts/ci-ledger.mjs) read together, kept in one
// tracking issue that each night's report replaces.
export const marker = '<!-- ci-health -->';
export const title = 'CI health report';

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const minutes = value => (value == null ? '—' : `${(value / 60).toFixed(1)} min`);
// A test takes seconds, so its duration reads in seconds; minutes would round most of them to 0.0.
const testSeconds = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const cell = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const row = values => `| ${values.map(cell).join(' | ')} |`;
const tally = items => [...items.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map())];

export function report(records, { now, days, runs, unreadable = 0 }) {
  const jobs = records.filter(record => record.kind === 'job');
  const tests = records.filter(record => record.kind === 'test');
  const lines = [marker, `# ${title}`, '', `The ${days} days to ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC: ${runs} runs.`];
  if (unreadable) lines.push('', `${unreadable} ledgers could not be read.`);

  const measured = jobs.filter(job => job.completed_at && ['success', 'failure'].includes(job.conclusion) && job.duration_s != null);
  lines.push('', '## Layers', '', row(['Layer', 'Jobs', 'p50', 'p90', 'Over budget']), '|---|---|---|---|---|');
  for (const layer of layers) {
    const own = measured.filter(job => job.layer === layer);
    if (!own.length) continue;
    const durations = own.map(job => job.duration_s);
    const over = own.filter(job => job.budget_s != null && job.duration_s > job.budget_s).length;
    lines.push(row([layer, own.length, minutes(percentile(durations, 50)), minutes(percentile(durations, 90)), over]));
  }

  const groups = new Map();
  for (const test of tests) {
    const key = JSON.stringify([test.layer, test.suite, test.file, test.name]);
    if (!groups.has(key)) groups.set(key, { layer: test.layer, suite: test.suite, file: test.file, name: test.name, durations: [], flaky: 0, failed: 0 });
    const group = groups.get(key);
    group.durations.push(test.duration_ms);
    if (test.outcome === 'flaky') group.flaky++;
    if (test.outcome === 'failed') group.failed++;
  }
  const named = group => `${group.file} › ${group.name}`;
  const slowest = [...groups.values()].map(group => ({ ...group, p50: percentile(group.durations, 50) }))
    .sort((a, b) => b.p50 - a.p50 || named(a).localeCompare(named(b))).slice(0, 20);
  lines.push('', '## Slowest tests', '', row(['Layer', 'Suite', 'Test', 'p50', 'Runs']), '|---|---|---|---|---|');
  for (const group of slowest) lines.push(row([group.layer, group.suite, named(group), testSeconds(group.p50), group.durations.length]));

  const unsteady = [...groups.values()].filter(group => group.flaky || group.failed)
    .sort((a, b) => b.flaky - a.flaky || b.failed - a.failed || named(a).localeCompare(named(b)));
  lines.push('', '## Flaky and failed tests', '');
  if (unsteady.length) {
    lines.push(row(['Layer', 'Test', 'Flaky', 'Failed']), '|---|---|---|---|');
    for (const group of unsteady) lines.push(row([group.layer, named(group), group.flaky, group.failed]));
  } else lines.push('None.');

  const red = jobs.filter(job => job.conclusion === 'failure');
  const labels = tally(red.map(job => {
    const found = job.classification;
    if (found?.label === 'infrastructure') return `infrastructure: ${found.cause}`;
    return found?.label === 'your change' ? 'your change' : 'log unavailable';
  })).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  lines.push('', '## Red jobs', '');
  if (labels.length) {
    lines.push(row(['Label', 'Jobs']), '|---|---|');
    for (const [label, count] of labels) lines.push(row([label, count]));
  } else lines.push('None.');

  const queues = jobs.filter(job => job.environment === 'self-hosted' && job.queue_s != null).map(job => job.queue_s);
  const fellBack = jobs.filter(job => job.layer === 'integration' && job.environment === 'github-hosted').length;
  lines.push('', '## PC queue', '',
    queues.length
      ? `${queues.length} jobs on the PC waited ${minutes(percentile(queues, 50))} at p50, ${minutes(percentile(queues, 90))} at p90 and ${minutes(Math.max(...queues))} at most.`
      : 'No job ran on the PC.',
    `${fellBack} integration jobs ran on a GitHub-hosted runner instead.`);
  return lines.join('\n') + '\n';
}

// `api(method, path, body)` takes a path inside the repository and returns the parsed JSON.
export async function upsertIssue(api, issueTitle, body) {
  const open = [];
  for (let page = 1; ; page++) {
    const found = await api('GET', `/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100&page=${page}`);
    open.push(...found);
    if (found.length < 100) break;
  }
  const existing = open.find(issue => !issue.pull_request && issue.title === issueTitle && (issue.body ?? '').startsWith(marker));
  if (existing) {
    await api('PATCH', `/issues/${existing.number}`, { body });
    return { action: 'updated', number: existing.number };
  }
  const created = await api('POST', '/issues', { title: issueTitle, body });
  return { action: 'created', number: created.number };
}

async function main() {
  const env = process.env;
  const days = 7;
  const cap = 400;
  const now = Date.now();
  const repo = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (method, path, body) => {
    const response = await fetch(`${repo}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${method} ${path.split('?')[0]}`);
    return response.json();
  };
  const since = now - days * 86400000;
  const artifacts = [];
  for (let page = 1; artifacts.length < cap; page++) {
    const { artifacts: found } = await api('GET', `/actions/artifacts?name=ledger&per_page=100&page=${page}`);
    const recent = found.filter(artifact => Date.parse(artifact.created_at) >= since);
    artifacts.push(...recent.filter(artifact => !artifact.expired));
    if (found.length < 100 || recent.length < found.length) break;
  }
  const folder = mkdtempSync(join(tmpdir(), 'ci-health-'));
  const records = [];
  let unreadable = 0;
  let runs = 0;
  try {
    for (const artifact of artifacts.slice(0, cap)) {
      try {
        const response = await fetch(artifact.archive_download_url, { headers });
        if (!response.ok) throw new Error(String(response.status));
        const zip = join(folder, `${artifact.id}.zip`);
        writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
        const text = execFileSync('unzip', ['-p', zip, 'ledger.jsonl'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
        records.push(...text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
        runs++;
      } catch {
        unreadable++;
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const body = report(records, { now, days, runs, unreadable });
  const { action, number } = await upsertIssue(api, title, body);
  process.stdout.write(`${body}\nThe report ${action} issue #${number}.\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`CI health report unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
