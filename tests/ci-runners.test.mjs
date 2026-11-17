import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { maxLanes, portOf, reservedPorts, stackPorts, stackPortsOf } from './lane.mjs';
import { lanesFor, movePorts } from '../scripts/ci-runner.mjs';

// Light jobs run on GitHub's free standard runners (#37). The heavy jobs run where the repo variable CI_RUNNER says,
// which is Omar's PC while ci-router keeps it there (#224); a pull request from a fork never reaches that machine or a
// secret. The old runner's name is assembled from pieces so this file does not match a search for it.
const piece = (...parts) => parts.join('');

const dir = '.github/workflows';
const workflows = readdirSync(dir).filter(name => /\.ya?ml$/.test(name))
 .map(name => ({ path: `${dir}/${name}`, text: readFileSync(`${dir}/${name}`, 'utf8') }))
 .map(file => ({ ...file, yaml: load(file.text) }));
const jobs = workflows.flatMap(({ path, yaml }) => Object.entries(yaml.jobs ?? {}).map(([name, job]) => ({ path, name, job, yaml })));
const ci = workflows.find(file => file.path === `${dir}/ci.yml`).yaml;

const heavyRunner = "${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && vars.CI_RUNNER || 'ubuntu-latest' }}";
const heavyJobs = ['integration'];
// The visual lane's proof draws on both runners, as a matrix (#257).
const bothJobs = ['lane-proof'];
const runnersOf = job => (job['runs-on'] === '${{ matrix.runner }}' ? job.strategy.matrix.runner : [job['runs-on']]);
const isHeavy = ({ path, name }) => path === `${dir}/ci.yml` && [...heavyJobs, ...bothJobs].includes(name);

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

test('the heavy jobs run on the CI_RUNNER runner, and on ubuntu-latest for a pull request from a fork (#224)', () => {
 for (const name of heavyJobs) assert.equal(ci.jobs[name]['runs-on'], heavyRunner, name);
 for (const name of bothJobs) assert.deepEqual(runnersOf(ci.jobs[name]), ['ubuntu-latest', heavyRunner], name);
});

test('every other job runs on a GitHub-hosted ubuntu-latest runner', () => {
 for (const { path, yaml } of workflows) assert.ok(Object.keys(yaml.jobs ?? {}).length > 0, `${path} has jobs`);
 for (const job of jobs.filter(job => !isHeavy(job))) assert.equal(job.job['runs-on'], 'ubuntu-latest', `${job.path} ${job.name}`);
});

test('the release and publish workflows run on ubuntu-latest', () => {
 const release = jobs.filter(({ path }) => [`${dir}/release.yml`, `${dir}/release-tag.yml`].includes(path));
 assert.ok(release.length >= 2);
 for (const { path, name, job } of release) assert.equal(job['runs-on'], 'ubuntu-latest', `${path} ${name}`);
});

test('a job that may run on the self-hosted runner reads no secret and writes nothing', () => {
 const mayRunThere = jobs.filter(({ job }) => runnersOf(job).includes(heavyRunner));
 assert.deepEqual(mayRunThere.map(({ name }) => name).sort(), [...heavyJobs, ...bothJobs].sort());
 for (const { name, job, yaml } of mayRunThere) {
  assert.equal(JSON.stringify(job).includes('secrets.'), false, name);
  const permissions = job.permissions ?? yaml.permissions;
  assert.equal(typeof permissions, 'object', `${name} names its permissions`);
  assert.deepEqual(Object.entries(permissions).filter(([, level]) => level === 'write'), [], name);
 }
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

// The local Supabase stack starts through ci.sh (database, images, integration, visual, visual-update, lane, lane-update,
// lane-proof) or scripts/local-db.sh.
const startsSupabase = step => /\bci\.sh\b.*\b(database|images|integration|visual|visual-update|lane|lane-update|lane-proof)\b|\blocal-db\.sh\b/.test(step.run ?? '');
const condition = step => String(step.if ?? '').replace(/^\$\{\{\s*|\s*\}\}$/g, '');
const supabaseJobs = jobs.filter(({ job }) => (job.steps ?? []).some(startsSupabase));
const label = ({ path, name }) => `${path} ${name}`;

test('the jobs that start the local Supabase stack are found', () => {
 for (const name of [`${dir}/ci.yml database`, `${dir}/ci.yml integration`, `${dir}/ci.yml lane`, `${dir}/ci.yml lane-proof`, `${dir}/visual-baselines.yml update`]) {
  assert.ok(supabaseJobs.map(label).includes(name), name);
 }
});

test('on a GitHub-hosted runner a job reserves the stack\'s ports before it starts the stack, and only there (#225)', () => {
 for (const job of supabaseJobs) {
  const steps = job.job.steps;
  const reserve = steps.findIndex(step => /sysctl -w net\.ipv4\.ip_local_reserved_ports=.*ci-runner\.mjs reserved-ports/.test(step.run ?? ''));
  assert.ok(reserve >= 0 && reserve < steps.findIndex(startsSupabase), `${label(job)} reserves the ports first`);
  assert.equal(condition(steps[reserve]), "runner.environment == 'github-hosted'", `${label(job)} leaves a self-hosted machine's kernel alone`);
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

test('on the self-hosted runner a job clears an earlier run and moves the ports before the stack starts, and cleans up last (#224)', () => {
 const config = readFileSync('supabase/config.toml', 'utf8');
 const checked = supabaseJobs.filter(({ job }) => runnersOf(job).includes(heavyRunner));
 for (const name of [...heavyJobs, ...bothJobs]) assert.ok(checked.some(job => job.name === name), name);
 for (const job of checked) {
  const steps = job.job.steps;
  const prepare = steps.findIndex(step => /ci-runner\.mjs move-ports \d+/.test(step.run ?? ''));
  assert.ok(prepare >= 0 && prepare < steps.findIndex(startsSupabase), `${label(job)} moves the ports first`);
  assert.equal(condition(steps[prepare]), "runner.environment != 'github-hosted'", label(job));
  assert.match(steps[prepare].run, /ci-runner\.mjs cleanup[\s\S]*ci-runner\.mjs move-ports/, `${label(job)} clears an earlier run first`);
  assert.doesNotThrow(() => movePorts(config, Number(steps[prepare].run.match(/move-ports (\d+)/)[1])), label(job));
  // The PC's Docker daemon does not see the job's /tmp: files handed to a container are written in the checkout.
  assert.match(steps[prepare].run, /echo "TMPDIR=\$GITHUB_WORKSPACE\/[^"]+" >> "\$GITHUB_ENV"/, `${label(job)} keeps its temporary files where the daemon sees them`);
  const last = steps.at(-1);
  assert.match(condition(last), /\balways\(\)/, label(job));
  assert.match(last.run ?? '', /ci-runner\.mjs cleanup/, `${label(job)} removes what it started`);
 }
});

test('move-ports puts every port of the stack in the block and changes nothing else', () => {
 const config = readFileSync('supabase/config.toml', 'utf8');
 const moved = movePorts(config, 640);
 assert.equal(stackPortsOf(moved).api, 64021);
 assert.deepEqual(stackPortsOf(moved), Object.fromEntries(Object.entries(stackPorts).map(([role, port]) => [role, 64000 + port % 100])));
 const before = config.split('\n');
 const after = moved.split('\n');
 assert.equal(after.length, before.length);
 const changed = before.flatMap((line, index) => line === after[index] ? [] : [index]);
 assert.equal(changed.length, Object.keys(stackPorts).length);
 for (const index of changed) {
  const [, key, port] = after[index].match(/^(port|shadow_port) = (\d+)$/);
  assert.equal(before[index].replace(/\d+$/, ''), `${key} = `);
  assert.ok(Number(port) >= 64000 && Number(port) < 64100, after[index]);
 }
 assert.equal(movePorts(moved, 640), moved, 'a second move to the same block changes nothing');
});

test('move-ports refuses a block whose lanes would leave 61000-65535', () => {
 const config = readFileSync('supabase/config.toml', 'utf8');
 // The last lane would pass 65535; the block would lie in Linux's range for outgoing connections; not a block.
 for (const block of [650, 609, 543, 640.5]) assert.throws(() => movePorts(config, block), RangeError, String(block));
});

test('a GitHub-hosted runner keeps four lanes', () => {
 assert.equal(lanesFor({ environment: 'github-hosted', cpus: 64, availableBytes: 2 ** 40 }), 4);
 assert.equal(lanesFor({ environment: 'github-hosted', cpus: 1, availableBytes: 2 ** 30 }), 4);
});

test('a self-hosted runner takes the lanes its CPUs and memory carry, at least one and at most maxLanes', () => {
 const GiB = 2 ** 30;
 assert.equal(lanesFor({ environment: 'self-hosted', cpus: 64, availableBytes: 256 * GiB }), maxLanes);
 assert.equal(lanesFor({ environment: 'self-hosted', cpus: 20, availableBytes: 8 * GiB }), 3, 'memory bound');
 assert.equal(lanesFor({ environment: 'self-hosted', cpus: 6, availableBytes: 100 * GiB }), 3, 'CPU bound');
 assert.equal(lanesFor({ environment: 'self-hosted', cpus: 1, availableBytes: GiB }), 1);
});

const script = resolve('scripts/ci-runner.mjs');
// Without GITHUB_WORKSPACE, cleanup stops no process: under CI it would name the checkout these tests run in.
const quietEnv = { ...process.env };
delete quietEnv.GITHUB_WORKSPACE;
const cli = (args, options = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: quietEnv, ...options });

test('the command line prints the reserved range and the lanes, and refuses what it does not know', () => {
 assert.equal(cli(['reserved-ports']).stdout, `${reservedPorts}\n`);
 assert.equal(cli(['lanes', 'github-hosted']).stdout, 'GTMWORKS_TEST_LANES=4\n');
 assert.match(cli(['lanes', 'self-hosted']).stdout, new RegExp(`^GTMWORKS_TEST_LANES=[1-${maxLanes}]\\n$`));
 for (const args of [['lanes', 'elsewhere'], ['move-ports'], ['prune']]) assert.equal(cli(args).status, 2, args.join(' '));
});

function checkout(t) {
 const root = mkdtempSync(join(tmpdir(), 'ci-runner-'));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 mkdirSync(join(root, 'supabase'));
 cpSync('supabase/config.toml', join(root, 'supabase/config.toml'));
 return root;
}

test('move-ports rewrites supabase/config.toml in place, and leaves it as it was when it refuses', t => {
 const root = checkout(t);
 const config = () => readFileSync(join(root, 'supabase/config.toml'), 'utf8');
 const before = config();
 assert.equal(cli(['move-ports', '650'], { cwd: root }).status, 2);
 assert.equal(config(), before);
 assert.equal(cli(['move-ports', '640'], { cwd: root }).status, 0);
 assert.equal(config(), movePorts(before, 640));
});

// A Docker that lists and removes what a JSON file holds, and records every command it is given.
const fakeDocker = `
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER, 'utf8'));
const [kind, verb, ...rest] = process.argv.slice(2);
state.calls.push([kind, verb, ...rest.filter(arg => !arg.startsWith('-') && !arg.includes('{{'))]);
if (verb === 'ls') for (const { name, project = '' } of state[kind]) console.log([name, project, ...(kind === 'container' ? ['Up 2 minutes'] : [])].join('\\t'));
if (verb === 'rm') state[kind] = state[kind].filter(object => object.stuck || !rest.includes(object.name));
fs.writeFileSync(process.env.FAKE_DOCKER, JSON.stringify(state));
`;
function docker(t, root, objects) {
 const bin = join(root, 'bin');
 mkdirSync(bin);
 writeFileSync(join(bin, 'docker'), `#!${process.execPath}\n${fakeDocker}`, { mode: 0o755 });
 const file = join(root, 'docker.json');
 writeFileSync(file, JSON.stringify({ calls: [], ...objects }));
 return { env: { ...quietEnv, PATH: `${bin}:${process.env.PATH}`, FAKE_DOCKER: file }, state: () => JSON.parse(readFileSync(file, 'utf8')) };
}

test('cleanup removes only what this repository\'s runs start on a shared Docker, and lists what is left', t => {
 const root = checkout(t);
 const others = {
  container: [{ name: 'supabase_db_rs-website-community', project: 'rs-website-community' }, { name: 'gtmworks-ci-old' }, { name: 'install-docker' }],
  volume: [{ name: 'supabase_db_rs-website-community', project: 'rs-website-community' }, { name: 'gtmworks-install-docker' }],
  network: [{ name: 'supabase_network_rs-website-community', project: 'rs-website-community' }, { name: 'bridge' }],
 };
 const fake = docker(t, root, {
  container: [
   { name: 'supabase_db_repo', project: 'repo' }, { name: `supabase_kong_repo-lane-${maxLanes - 1}`, project: `repo-lane-${maxLanes - 1}` },
   { name: 'gtmworks-ci' }, { name: 'gtmworks-worker-ci' }, { name: 'gtmworks-proxy-app' }, { name: 'gtmworks-proxy-caddy' }, { name: 'gtmworks-lane-renderer' },
   ...others.container,
  ],
  volume: [{ name: 'supabase_db_repo', project: 'repo' }, { name: 'gtmworks-proxy-caddy-data' }, ...others.volume],
  network: [{ name: 'supabase_network_repo' }, { name: 'supabase_network_repo-lane-3' }, ...others.network],
 });
 const result = cli(['cleanup'], { cwd: root, env: fake.env });
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /gtmworks containers left on this runner:\nnone\n$/);
 const { calls, ...left } = fake.state();
 assert.deepEqual(left, others);
 assert.deepEqual(calls.filter(([, verb]) => verb !== 'ls' && verb !== 'rm'), [], 'no prune or other command');
});

test('cleanup fails and names what it could not remove', t => {
 const root = checkout(t);
 const fake = docker(t, root, { container: [{ name: 'supabase_db_repo', project: 'repo', stuck: true }], volume: [], network: [] });
 const result = cli(['cleanup'], { cwd: root, env: fake.env });
 assert.equal(result.status, 1);
 assert.match(result.stdout, /gtmworks containers left on this runner:\ncontainer supabase_db_repo Up 2 minutes\n$/);
});

test('cleanup stops the processes working in the checkout, but not itself, what started it or anything outside', async t => {
 const root = checkout(t);
 const fake = docker(t, root, { container: [], volume: [], network: [] });
 const idle = ['-e', 'setInterval(() => {}, 1000)'];
 const leftover = spawn(process.execPath, idle, { cwd: join(root, 'supabase') });
 const outside = spawn(process.execPath, idle, { cwd: tmpdir() });
 t.after(() => outside.kill('SIGKILL'));
 const stopped = new Promise(done => leftover.on('exit', (code, signal) => done(signal)));
 // A step's shell in the checkout starts it, as on a runner; the command after it keeps bash from exec'ing node.
 const result = spawnSync('bash', ['-c', `"${process.execPath}" "${script}" cleanup; exit $?`], { cwd: root, encoding: 'utf8', env: { ...fake.env, GITHUB_WORKSPACE: root } });
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, new RegExp(`stopped process ${leftover.pid} `));
 assert.equal(await stopped, 'SIGKILL');
 assert.equal(outside.exitCode ?? outside.signalCode, null);
});
