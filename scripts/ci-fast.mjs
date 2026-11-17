import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// The fast layer (#258, spec #255 D1): the static checks, the node tests and the component tests, run at the same time
// as one command that CI, an agent and a person run alike. Each step keeps its own output and result, so a red step is
// shown whole and the others stay green. Each command may write its test records to $LEDGER (scripts/ci-ledger.mjs).
export const steps = [
  // First and alone: a test file no runner discovers is named before any other check starts.
  { name: 'discovery', command: 'node scripts/check-test-discovery.mjs', first: true },
  { name: 'docs', command: 'python3 scripts/check-design-adr.py' },
  { name: 'i18n', command: 'node scripts/check-i18n.mjs' },
  { name: 'openapi', command: 'npx --yes @redocly/cli@2.76.0 lint docs/api/openapi.yaml --extends=spec' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'typecheck', command: 'npm run typecheck' },
  // Unused files, exports and dependencies (knip.json), as T3 Code checks them (#81).
  { name: 'knip', command: 'npx --no-install knip --no-progress' },
  // `npm test`'s files, with the ledger reporter beside the usual one; the flags must come before the glob.
  { name: 'node', command: 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/ci-ledger-node.mjs --test-reporter-destination="$LEDGER/node.jsonl" \'tests/**/*.test.mjs\'' },
  // Screens as components in headless Chromium (#81), in one run: the tests take seconds, so shards would only repeat
  // the install and the browser (spec #255 D2). Naming the reporters replaces Vitest's own choice, so the GitHub one that
  // marks failures on the pull request is named too when it runs there.
  { name: 'components', command: 'npx playwright install chromium && npm run test:components -- --reporter=default ${GITHUB_ACTIONS:+--reporter=github-actions} --reporter=json --outputFile.json="$LEDGER/vitest.json"' },
];

const seconds = started => ((Date.now() - started) / 1000).toFixed(1);

/**
 * Runs the `first` steps, then, when they passed, every other step at once, and prints each one's output when it ends.
 * Resolves to [{ name, result }] in step order.
 */
export async function run(list, { skip = [], env = process.env, write = text => process.stdout.write(text) } = {}) {
  const github = env.GITHUB_ACTIONS === 'true';
  const running = new Set();
  const show = (name, result, output, started, code) => {
    const header = `fast ${name}: ${result} (${seconds(started)} s)`;
    const text = output.endsWith('\n') || !output ? output : `${output}\n`;
    if (github && result === 'success') write(`::group::${header}\n${text}::endgroup::\n`);
    else write(`${header}\n${text}`);
    if (github && result !== 'success') write(`::error title=fast ${name}::${name} failed (exit ${code}); its output is in the log above\n`);
  };
  const stop = () => { for (const child of running) try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  process.once('SIGINT', stop).once('SIGTERM', stop);
  const start = ({ name, command }) => {
    if (skip.includes(name)) return { name, result: 'skipped' };
    write(`fast ${name}: started\n`);
    const started = Date.now();
    const chunks = [];
    // A group of its own, so a stop reaches what npm and npx start under it.
    const child = spawn('bash', ['-c', command], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    running.add(child);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    return new Promise(resolve => child.on('close', (code, signal) => {
      running.delete(child);
      const result = code === 0 ? 'success' : signal ? 'cancelled' : 'failure';
      show(name, result, Buffer.concat(chunks).toString(), started, code ?? signal);
      resolve({ name, result });
    }));
  };
  const gate = await Promise.all(list.filter(step => step.first).map(start));
  const open = gate.every(({ result }) => result === 'success' || result === 'skipped');
  const rest = await Promise.all(list.filter(step => !step.first).map(step => (open ? start(step) : { name: step.name, result: 'skipped' })));
  const results = list.map(step => [...gate, ...rest].find(({ name }) => name === step.name));
  process.off('SIGINT', stop).off('SIGTERM', stop);
  write(results.map(({ name, result }) => `fast ${name}: ${result}\n`).join(''));
  return results;
}

/** The fast job's `steps` output, which `check` lists (scripts/ci-verdict.mjs). */
export const outputLine = results => `steps=${results.map(({ name, result }) => `${name}=${result}`).join(' ')}`;

async function main(argv) {
  const { values, positionals: [ledger] } = parseArgs({ args: argv, allowPositionals: true, options: { skip: { type: 'string', multiple: true, default: [] }, only: { type: 'string', multiple: true } } });
  if (!ledger) throw new Error('usage: node scripts/ci-fast.mjs <ledger folder> [--skip <step>]... [--only <step>]...');
  const unknown = [...values.skip, ...(values.only ?? [])].filter(name => !steps.some(step => step.name === name));
  if (unknown.length) throw new Error(`no such step: ${unknown.join(', ')}`);
  const list = values.only ? steps.filter(step => values.only.includes(step.name)) : steps;
  const results = await run(list, { skip: values.skip, env: { ...process.env, LEDGER: ledger } });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputLine(results)}\n`);
  process.exitCode = results.every(({ result }) => result !== 'failure' && result !== 'cancelled') ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
