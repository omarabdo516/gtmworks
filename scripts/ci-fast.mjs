import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { rules } from './ci-classify.mjs';

// The fast layer (#258, spec #255 D1): the static checks, the node tests and the component tests, run at the same time
// as one command that CI, an agent and a person run alike. Each step keeps its own output and result, so a red step is
// shown whole and the others stay green. Each command may write its test records to $LEDGER (scripts/ci-ledger.mjs).
// The steps share the runner's four cores: one that `yields` runs at a lower CPU priority, so the one-thread checks
// (lint, types) keep a core each and the test runners, which spread over every core, fill what is left.
export const steps = [
  // The gate: a test file no runner discovers is named before any other step starts.
  { name: 'discovery', command: 'node scripts/check-test-discovery.mjs', gate: true },
  { name: 'docs', command: 'python3 scripts/check-design-adr.py' },
  { name: 'i18n', command: 'node scripts/check-i18n.mjs' },
  { name: 'openapi', command: 'npm_config_cache="${NPX_CACHE:-$HOME/.npm}" npx --prefer-offline --yes @redocly/cli@2.76.0 lint docs/api/openapi.yaml --extends=spec' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'typecheck', command: 'npm run typecheck' },
  // Unused files, exports and dependencies (knip.json), as T3 Code checks them (#81).
  { name: 'knip', command: 'npx --no-install knip --no-progress' },
  // `npm test`'s files, offline as `npm test` runs them (#266), with the ledger reporter beside the usual one; the flags
  // must come before the glob.
  { name: 'node', command: 'node --import ./tests/offline.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/ci-ledger-node.mjs --test-reporter-destination="$LEDGER/node.jsonl" \'tests/**/*.test.mjs\'', yields: true },
  // Screens as components in headless Chromium (#81), in one run: the tests take seconds, so shards would only repeat
  // the install and the browser (spec #255 D2). Naming the reporters replaces Vitest's own choice, so the GitHub one that
  // marks failures on the pull request is named too when it runs there. CI's workflow brings the browser; elsewhere the
  // step installs it, after the discovery gate.
  { name: 'components', command: '{ [ "${CI:-}" = true ] || npx playwright install chromium; } && npm run test:components -- --reporter=default ${GITHUB_ACTIONS:+--reporter=github-actions} --reporter=json --outputFile.json="$LEDGER/vitest.json"', yields: true },
];

const fatal = rules.filter(rule => rule.scope === 'fatal');
const infrastructure = output => output.split('\n').some(line => fatal.some(rule => rule.pattern.test(line)));
const seconds = started => ((Date.now() - started) / 1000).toFixed(1);

/**
 * Runs the `gate` steps, then, when they passed, every other step at once; when one failed the others are skipped. Prints each step's output when it ends. Resolves to [{ name, result }] in step order.
 */
export async function run(list, { skip = [], env = process.env, write = text => process.stdout.write(text) } = {}) {
  const github = env.GITHUB_ACTIONS === 'true';
  const running = new Set();
  const failed = [];
  const show = (name, result, output, started, code) => {
    const header = `fast ${name}: ${result} (${seconds(started)} s)`;
    const text = output.endsWith('\n') || !output ? output : `${output}\n`;
    if (result === 'success') write(github ? `::group::${header}\n${text}::endgroup::\n` : `${header}\n${text}`);
    // A red step's output waits for the end, so the job's last lines are the failure (scripts/ci-classify.mjs reads them).
    else failed.push((infrastructure(output) ? '0' : '1') + (github ? `::error title=fast ${name}::${name} failed (exit ${code}); its output is in the log below\n` : '') + `${header}\n${text}`);
  };
  const stop = () => { for (const child of running) try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  process.once('SIGINT', stop).once('SIGTERM', stop);
  const start = ({ name, command, yields }) => {
    if (skip.includes(name)) return { name, result: 'skipped' };
    write(`fast ${name}: started\n`);
    const started = Date.now();
    const chunks = [];
    // Written as it arrives: a step that hangs until the job's time limit still leaves its log for the ledger upload.
    let log = env.LEDGER ? createWriteStream(`${env.LEDGER}/${name}.log`) : null;
    log?.on('error', () => { log = null; });
    // A group of its own, so a stop reaches what npm and npx start under it.
    const child = spawn(yields ? 'nice' : 'bash', [...(yields ? ['-n', '10', 'bash'] : []), '-c', command], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    running.add(child);
    // A step that cannot be started (no shell, no processes left) is red with the reason, like one that failed.
    child.on('error', error => chunks.push(Buffer.from(`${error.message}\n`)));
    const keep = chunk => { chunks.push(chunk); log?.write(chunk); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    return new Promise(resolve => child.on('close', (code, signal) => {
      running.delete(child);
      const result = code === 0 ? 'success' : signal ? 'cancelled' : 'failure';
      const settle = () => { show(name, result, Buffer.concat(chunks).toString(), started, code ?? signal); resolve({ name, result }); };
      // A step is settled once its log file is closed, so nothing writes into the ledger folder after the run returns.
      if (log) { log.once('close', settle); log.end(); } else settle();
    }));
  };
  const gates = new Map(list.filter(step => step.gate).map(step => [step.name, start(step)]));
  const open = Promise.all(gates.values()).then(done => done.every(({ result }) => result === 'success' || result === 'skipped'));
  const results = await Promise.all(list.map(step => gates.get(step.name)
    ?? open.then(passed => (passed ? start(step) : { name: step.name, result: 'skipped' }))));
  process.off('SIGINT', stop).off('SIGTERM', stop);
  write(results.map(({ name, result }) => `fast ${name}: ${result}\n`).join(''));
  // Infrastructure-looking failures first, so a real one, if any, is what the job ends on.
  for (const text of failed.sort((a, b) => a[0].localeCompare(b[0]))) write(text.slice(1));
  return results;
}

/** The steps `--only` names, in table order, with the gate before them. */
export const choose = (list, only) => (only ? list.filter(step => step.gate || only.includes(step.name)) : list);

/** The fast job's `steps` output, which `check` lists (scripts/ci-verdict.mjs). */
export const outputLine = results => `steps=${results.map(({ name, result }) => `${name}=${result}`).join(' ')}`;

async function main(argv) {
  const { values, positionals: [ledger] } = parseArgs({ args: argv, allowPositionals: true, options: { skip: { type: 'string', multiple: true, default: [] }, only: { type: 'string', multiple: true } } });
  if (!ledger) throw new Error('usage: node scripts/ci-fast.mjs <ledger folder> [--skip <step>]... [--only <step>]...');
  const unknown = [...values.skip, ...(values.only ?? [])].filter(name => !steps.some(step => step.name === name));
  if (unknown.length) throw new Error(`no such step: ${unknown.join(', ')}`);
  mkdirSync(ledger, { recursive: true });
  const list = choose(steps, values.only);
  const results = await run(list, { skip: values.skip, env: { ...process.env, LEDGER: ledger } });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputLine(results)}\n`);
  process.exitCode = results.every(({ result }) => result !== 'failure' && result !== 'cancelled') ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
