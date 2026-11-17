import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layers } from './ci-ledger.mjs';

// The nightly CI health report (#256): the last days of ledgers (scripts/ci-ledger.mjs) read together, kept in one
// tracking issue that each night's report replaces.
const marker = '<!-- ci-health -->';
const title = 'CI health report';

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const minutes = value => (value == null ? '—' : `${(value / 60).toFixed(1)} min`);
// A test takes seconds, so its duration reads in seconds; minutes would round most of them to 0.0.
const testSeconds = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
// A ledger is written by CI code a pull request may change, so its text is cut and made inert before it reaches the
// issue: no markup or hidden comment, no code span, no mention, no issue reference or address, no link or image, no
// broken row. It is cut by character, so no half of one is left.
const width = 200;
const cell = value => {
  const characters = [...String(value).replace(/[\r\n]+/g, ' ')];
  const text = characters.length > width ? `${characters.slice(0, width - 1).join('')}…` : characters.join('');
  return text.replaceAll('\\', '\\\\').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('`', '\\`').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('@', '@\u200b').replaceAll('#', '#\u200b')
    .replaceAll('://', ':\u200b//').replace(/www\./gi, match => `${match.slice(0, 3)}\u200b.`).replace(/GH-/gi, match => `${match.slice(0, 2)}\u200b-`)
    .replaceAll('|', '\\|');
};
const row = values => `| ${values.map(cell).join(' | ')} |`;
// An issue body holds at most 65536 characters, so each list of tests stops at 20.
const shown = 20;
const tally = items => [...items.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map())];

// What the report reads of each record; a record of another shape is refused and counted, never half read.
const text = value => typeof value === 'string';
const textOrNull = value => value === null || text(value);
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const countOrNull = value => value === null || count(value);
const shapes = {
  run: { run_id: count },
  job: {
    layer: text, conclusion: textOrNull, completed_at: textOrNull, duration_s: countOrNull, queue_s: countOrNull,
    budget_s: countOrNull, environment: textOrNull,
    classification: value => value === null || (typeof value === 'object' && text(value.label) && textOrNull(value.cause ?? null)),
  },
  test: {
    layer: text, suite: text, file: textOrNull, name: text, duration_ms: count,
    outcome: value => ['passed', 'failed', 'skipped', 'flaky'].includes(value),
  },
};
const fits = record => {
  const shape = record && typeof record === 'object' && Object.hasOwn(shapes, record.kind) ? shapes[record.kind] : null;
  return Boolean(shape) && Object.entries(shape).every(([field, check]) => check(record[field] ?? null));
};

// A run's ledger holds about 2,000 records; one far longer is not read past this.
const maxRecords = 20000;

export function readLedger(ledger, { maxRecords: most = maxRecords } = {}) {
  const records = [];
  let rejected = 0;
  let cut = 0;
  for (const line of ledger.split('\n').filter(line => line.trim())) {
    if (records.length >= most) {
      cut++;
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      rejected++;
      continue;
    }
    if (fits(record)) records.push(record);
    else rejected++;
  }
  return { records, rejected, cut };
}

// The ledgers read together stop at `totalRecords`; a ledger that would pass it is left out and counted.
// About 2,000 records a run; past this many in all, the rest are left out and counted rather than read.
const totalRecords = 1000000;

export function ledgerCollector({ maxRecords: most = maxRecords, totalRecords: total = totalRecords } = {}) {
  const collector = {
    records: [], rejected: 0, cut: 0, read: 0, skipped: 0,
    add(ledger) {
      const found = readLedger(ledger, { maxRecords: most });
      if (collector.records.length + found.records.length > total) {
        collector.skipped++;
        return;
      }
      for (const record of found.records) collector.records.push(record);
      collector.rejected += found.rejected;
      collector.cut += found.cut;
      collector.read++;
    },
  };
  return collector;
}

// GitHub refuses an issue body over 65536 characters.
const bodyLimit = 65000;

export function report(records, { now, days, runs, unreadable = 0, left = 0, rejected = 0, cut = 0, skipped = 0, foreign = 0, limit = bodyLimit }) {
  const jobs = records.filter(record => record.kind === 'job');
  const tests = records.filter(record => record.kind === 'test');
  const lines = [marker, `# ${title}`, '', `The ${days} days to ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC: ${runs} runs.`];
  if (unreadable) lines.push('', `${unreadable} ledgers could not be read.`);
  if (rejected) lines.push('', `${rejected} records could not be read.`);
  if (cut) lines.push('', `${cut} records past one ledger's cap of ${maxRecords} were not read.`);
  if (skipped) lines.push('', `${skipped} ledgers past the total cap of ${totalRecords} records were not read.`);
  if (foreign) lines.push('', `${foreign} ledgers from a fork or another workflow were not counted.`);
  if (left) lines.push('', `Only the newest ledgers were read: ${left} older ones in the window are not counted.`);

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
    // A skipped test did not run, so it adds no duration and no run.
    if (test.outcome !== 'skipped') group.durations.push(test.duration_ms);
    if (test.outcome === 'flaky') group.flaky++;
    if (test.outcome === 'failed') group.failed++;
  }
  const named = group => `${group.file} › ${group.name}`;
  const slowest = [...groups.values()].filter(group => group.durations.length).map(group => ({ ...group, p50: percentile(group.durations, 50) }))
    .sort((a, b) => b.p50 - a.p50 || named(a).localeCompare(named(b))).slice(0, shown);
  lines.push('', '## Slowest tests', '', row(['Layer', 'Suite', 'Test', 'p50', 'Runs']), '|---|---|---|---|---|');
  for (const group of slowest) lines.push(row([group.layer, group.suite, named(group), testSeconds(group.p50), group.durations.length]));

  const unsteady = [...groups.values()].filter(group => group.flaky || group.failed)
    .sort((a, b) => b.flaky - a.flaky || b.failed - a.failed || named(a).localeCompare(named(b)));
  lines.push('', '## Flaky and failed tests', '');
  if (unsteady.length) {
    lines.push(row(['Layer', 'Test', 'Flaky', 'Failed']), '|---|---|---|---|');
    for (const group of unsteady.slice(0, shown)) lines.push(row([group.layer, named(group), group.flaky, group.failed]));
    if (unsteady.length > shown) lines.push('', `${unsteady.length - shown} more not shown.`);
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
      ? `${queues.length} jobs on the PC waited ${minutes(percentile(queues, 50))} at p50, ${minutes(percentile(queues, 90))} at p90 and ${minutes(queues.reduce((most, queue) => Math.max(most, queue), 0))} at most.`
      : 'No job ran on the PC.',
    `${fellBack} integration jobs ran on a GitHub-hosted runner instead.`);
  const body = lines.join('\n') + '\n';
  if (body.length <= limit) return body;
  const note = `\nThe report was cut to stay under ${limit} characters.\n`;
  const shortened = body.slice(0, limit - note.length);
  return shortened.slice(0, shortened.lastIndexOf('\n') + 1) + note;
}

// Which ledgers a report reads: those of this repository's own ci.yml runs (never a fork's pull request, whose ledger
// its own code wrote), in the window, not expired and under the size cap, newest first and at most `cap` of them.
// A ledger whose run the listing did not return (a rerun of an older run, or past the listing's end) is named in
// `missing`, so the caller looks its run up on its own; none is dropped without a count.
export function selectLedgers(artifacts, runs, { since, cap, maxBytes }) {
  const byId = new Map(runs.map(run => [run.id, run]));
  const isOwn = run => run.path === '.github/workflows/ci.yml' && run.repository?.id != null && run.head_repository?.id === run.repository.id;
  const recent = artifacts.filter(artifact => artifact.name === 'ledger' && !artifact.expired && Date.parse(artifact.created_at) >= since);
  const missing = [...new Set(recent.map(artifact => artifact.workflow_run?.id).filter(id => !byId.has(id)))];
  const known = recent.filter(artifact => byId.has(artifact.workflow_run?.id));
  const own = known.filter(artifact => isOwn(byId.get(artifact.workflow_run.id)));
  const fitting = own.filter(artifact => artifact.size_in_bytes <= maxBytes)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    ledgers: fitting.slice(0, cap), left: Math.max(0, fitting.length - cap), tooLarge: own.length - fitting.length,
    foreign: known.length - own.length, missing,
  };
}

// A pull request's run proves the report and writes nothing: the tracking issue is only written from the default branch.
export async function publish(api, body, { dryRun }) {
  if (dryRun) return { action: 'dry run', number: null };
  return upsertIssue(api, title, body);
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
  // A ledger zip is about 50 kB; anything far larger is not one of ours.
  const maxBytes = 5 * 1024 * 1024;
  const now = Date.now();
  const repo = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (method, path, body) => {
    const response = await fetch(`${repo}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${method} ${path.split('?')[0]}`);
    return response.json();
  };
  const since = now - days * 86400000;
  // Newest first and unfiltered: GitHub returns at most 1,000 runs for a filtered list. A ledger whose run is not among
  // these (a rerun of an older run) gets its run looked up on its own below.
  const runs = [];
  for (let page = 1; ; page++) {
    const { workflow_runs: found } = await api('GET', `/actions/workflows/ci.yml/runs?per_page=100&page=${page}`);
    runs.push(...found);
    if (found.length < 100 || found.some(run => Date.parse(run.created_at) < since)) break;
  }
  const artifacts = [];
  for (let page = 1; ; page++) {
    const { artifacts: found } = await api('GET', `/actions/artifacts?name=ledger&per_page=100&page=${page}`);
    artifacts.push(...found);
    if (found.length < 100 || found.some(artifact => Date.parse(artifact.created_at) < since)) break;
  }
  let unreadable = 0;
  const missing = selectLedgers(artifacts, runs, { since, cap, maxBytes }).missing;
  // Each lookup is one request of the token's hourly allowance; past 100, a ledger's run is not looked up and is counted.
  for (const id of missing.slice(100)) unreadable += artifacts.filter(artifact => artifact.workflow_run?.id === id).length;
  for (const id of missing.slice(0, 100)) {
    try {
      runs.push(await api('GET', `/actions/runs/${Number(id)}`));
    } catch {
      unreadable += artifacts.filter(artifact => artifact.workflow_run?.id === id).length;
    }
  }
  const { ledgers, left, tooLarge, foreign } = selectLedgers(artifacts, runs, { since, cap, maxBytes });
  unreadable += tooLarge;
  const collector = ledgerCollector();
  const folder = mkdtempSync(join(tmpdir(), 'ci-health-'));
  try {
    for (const artifact of ledgers) {
      try {
        const response = await fetch(artifact.archive_download_url, { headers });
        if (!response.ok) throw new Error(String(response.status));
        const zip = join(folder, `${artifact.id}.zip`);
        writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
        collector.add(execFileSync('unzip', ['-p', zip, 'ledger.jsonl'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
      } catch {
        unreadable++;
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const { records, rejected, cut, read, skipped } = collector;
  const body = report(records, { now, days, runs: read, unreadable, rejected, cut, skipped, foreign, left });
  const { action, number } = await publish(api, body, { dryRun: env.DRY_RUN === 'true' });
  process.stdout.write(`${body}\n${action === 'dry run' ? 'Dry run: no issue was written.' : `The report ${action} issue #${number}.`}\n`);
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
