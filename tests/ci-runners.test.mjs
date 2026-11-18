import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { maxLanes, portOf, reservedPorts, stackPorts } from './lane.mjs';

// Every job runs on GitHub's free standard runners (#37, decision 0038): the PC runs no gtmworks job any more (#334).
// The old runner's name is assembled from pieces so this file does not match a search for it.
const piece = (...parts) => parts.join('');

const dir = '.github/workflows';
const workflows = readdirSync(dir).filter(name => /\.ya?ml$/.test(name))
 .map(name => ({ path: `${dir}/${name}`, text: readFileSync(`${dir}/${name}`, 'utf8') }))
 .map(file => ({ ...file, yaml: load(file.text) }));
const jobs = workflows.flatMap(({ path, yaml }) => Object.entries(yaml.jobs ?? {}).map(([name, job]) => ({ path, name, job, yaml })));
const ci = workflows.find(file => file.path === `${dir}/ci.yml`).yaml;


function triggers(yaml) {
 // js-yaml reads `on` as a string key; a YAML 1.1 parser would read it as true.
 const on = yaml.on ?? yaml[true];
 if (typeof on === 'string') return [on];
 if (Array.isArray(on)) return on;
 return Object.keys(on ?? {});
}

test('the scan sees every workflow', () => {
 const paths = workflows.map(file => file.path);
 for (const path of ['ci.yml', 'design-compare.yml', 'release.yml', 'release-tag.yml', 'visual-baselines.yml']) assert.ok(paths.includes(`${dir}/${path}`), path);
});

test('no workflow names the paid runner', () => {
 const pattern = new RegExp(piece('ubi', 'cloud'), 'i');
 for (const { path, text } of workflows) assert.equal(pattern.test(text), false, path);
});

test('every job runs on a GitHub-hosted ubuntu-latest runner', () => {
 for (const { path, yaml } of workflows) assert.ok(Object.keys(yaml.jobs ?? {}).length > 0, `${path} has jobs`);
 for (const job of jobs) assert.equal(job.job['runs-on'], 'ubuntu-latest', `${job.path} ${job.name}`);
});

// Hermes and T3 Code keep no CI ledger, health report, cross-runner proof or PC routing, so neither does gtmworks (#334).
test('no ledger, CI health, lane-proof or PC-routing job is left, nor the scripts behind them (#334)', () => {
 const names = jobs.map(({ path, name }) => `${path} ${name}`);
 for (const removed of ['ledger', 'lane-proof', 'lane-proof-compare']) assert.ok(!names.includes(`${dir}/ci.yml ${removed}`), removed);
 assert.ok(!workflows.some(({ path }) => path === `${dir}/ci-health.yml`), 'ci-health.yml');
 for (const { path, text } of workflows) {
  for (const word of ['CI_RUNNER', 'ci-ledger.mjs', 'ledger-', 'ci-health', 'lane-proof', 'move-ports', 'ci-runner.mjs cleanup', 'ci-runner.mjs lanes']) {
   assert.equal(text.includes(word), false, `${path} names ${word}`);
  }
 }
 for (const path of ['scripts/ci-ledger.mjs', 'scripts/ci-ledger-node.mjs', 'scripts/ci-health.mjs']) assert.equal(existsSync(path), false, path);
 assert.doesNotMatch(readFileSync('ci.sh', 'utf8'), /lane-proof|self-hosted/);
});

test('the release and publish workflows run on ubuntu-latest', () => {
 const release = jobs.filter(({ path }) => [`${dir}/release.yml`, `${dir}/release-tag.yml`].includes(path));
 assert.ok(release.length >= 2);
 for (const { path, name, job } of release) assert.equal(job['runs-on'], 'ubuntu-latest', `${path} ${name}`);
});

test('no workflow runs on pull_request_target', () => {
 for (const { path, text, yaml } of workflows) {
  assert.equal(triggers(yaml).includes('pull_request_target'), false, path);
  assert.equal(text.includes('pull_request_target'), false, path);
 }
});

test('a workflow a pull request starts reads no secret but GITHUB_TOKEN', () => {
 const pullRequest = workflows.filter(({ yaml }) => triggers(yaml).includes('pull_request'));
 assert.ok(pullRequest.some(file => file.path === `${dir}/ci.yml`), 'ci.yml runs on pull_request');
 const secret = /\bsecrets\b(?!\.GITHUB_TOKEN\b)/;
 for (const { path, text } of pullRequest) {
  const found = text.split('\n').flatMap((line, index) => secret.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : []);
  assert.deepEqual(found, [], path);
 }
});

// The local Supabase stack starts through ci.sh (database, images, integration, visual, visual-update) or
// scripts/local-db.sh.
const startsSupabase = step => /\bci\.sh\b.*\b(database|images|integration|visual|visual-update)\b|\blocal-db\.sh\b/.test(step.run ?? '');
const condition = step => String(step.if ?? '').replace(/^\$\{\{\s*|\s*\}\}$/g, '');
const supabaseJobs = jobs.filter(({ job }) => (job.steps ?? []).some(startsSupabase));
const label = ({ path, name }) => `${path} ${name}`;

test('the jobs that start the local Supabase stack are found', () => {
 for (const name of [`${dir}/ci.yml database`, `${dir}/ci.yml integration`, `${dir}/ci.yml visual`, `${dir}/visual-baselines.yml update`]) {
  assert.ok(supabaseJobs.map(label).includes(name), name);
 }
});

test('a job reserves the stack\'s ports before it starts the stack (#225)', () => {
 for (const job of supabaseJobs) {
  const steps = job.job.steps;
  const reserve = steps.findIndex(step => /sysctl -w net\.ipv4\.ip_local_reserved_ports=.*ci-runner\.mjs reserved-ports/.test(step.run ?? ''));
  assert.ok(reserve >= 0 && reserve < steps.findIndex(startsSupabase), `${label(job)} reserves the ports first`);
  assert.equal(condition(steps[reserve]), "runner.environment == 'github-hosted'", label(job));
  assert.match(steps[reserve].run, /^\s*sysctl net\.ipv4\.ip_local_reserved_ports\s*$/m, `${label(job)} prints the reservation`);
 }
});

test('every port the stack and each of its lanes binds lies inside the reserved range (#225)', () => {
 const [low, high] = reservedPorts.split('-').map(Number);
 const inside = port => port >= low && port <= high;
 // scripts/local-db.sh moves every one of these lines by 100 per lane.
 const lines = [...readFileSync('supabase/config.toml', 'utf8').matchAll(/^(?:port|shadow_port) = (\d+)$/gm)].map(match => Number(match[1]));
 assert.equal(lines.length, Object.keys(stackPorts).length);
 for (let n = 0; n < maxLanes; n++) {
  for (const port of lines) assert.ok(inside(port + 100 * n), `${port + 100 * n} (lane ${n}) in ${reservedPorts}`);
  for (const role of Object.keys(stackPorts)) assert.ok(inside(portOf(role, n)), `${role} of lane ${n} in ${reservedPorts}`);
 }
});

test('the scripts accept exactly the lanes tests/lane.mjs reserves ports for', () => {
 const accepted = (file, variable) => {
  const pattern = new RegExp(readFileSync(file, 'utf8').match(new RegExp(`\\[\\[ \\$${variable} =~ (\\S+) \\]\\]`))[1]);
  return Array.from({ length: 12 }, (_, n) => n).filter(n => pattern.test(String(n)));
 };
 const from = (first, last) => Array.from({ length: last - first + 1 }, (_, n) => first + n);
 assert.deepEqual(accepted('scripts/local-db.sh', 'lane'), from(0, maxLanes - 1));
 assert.deepEqual(accepted('scripts/web.sh', 'lane'), from(0, maxLanes - 1));
 assert.deepEqual(accepted('ci.sh', 'lanes'), from(1, maxLanes));
});

const script = resolve('scripts/ci-runner.mjs');
const cli = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('the command line prints the reserved range, and refuses what it does not know', () => {
 assert.equal(cli(['reserved-ports']).stdout, `${reservedPorts}\n`);
 for (const args of [['lanes', 'github-hosted'], ['move-ports', '640'], ['cleanup'], ['prune']]) assert.equal(cli(args).status, 2, args.join(' '));
});
