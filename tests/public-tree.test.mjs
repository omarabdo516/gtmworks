import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { load } from 'js-yaml';

// The tree is published as a public repository (#324); these checks keep it fit to be read by anyone.
// Patterns naming private places are assembled from pieces so this file does not match itself.
const piece = (...parts) => parts.join('');

const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
 .split('\0').filter(path => path && existsSync(path) && statSync(path).isFile());
const texts = new Map();
for (const path of tracked) {
 const bytes = readFileSync(path);
 if (!bytes.subarray(0, 8000).includes(0)) texts.set(path, bytes.toString('utf8'));
}
// The approved design reference is frozen byte for byte (its SHA256SUMS), so it is never edited here.
const outsideReference = path => !path.startsWith('design-reference/');

function offenders(pattern, keep = () => true) {
 const found = [];
 for (const [path, text] of texts) {
  if (!keep(path)) continue;
  text.split('\n').forEach((line, index) => { if (pattern.test(line)) found.push(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`); });
 }
 return found;
}

test('the scan sees the tree', () => {
 assert.ok(texts.size > 100, `only ${texts.size} text files found`);
 assert.ok(texts.has('AGENTS.md') && texts.has('tests/public-tree.test.mjs'));
});

test('superseded decision records and every sentence about subscription tokens are gone', () => {
 for (const record of ['0001-ai-runs-on-company-subscription-tokens.md', '0003-ai-runs-worker-decrypts-one-container-per-run.md',
  '0005-dashboard-runs-no-ai-hermes-writes-through-an-api.md']) assert.equal(existsSync(`docs/adr/${record}`), false, record);
 const decisions = path => path.startsWith('docs/') || path === 'GLOSSARY.md';
 for (const pattern of [/subscription tokens?/i, /session tokens?/i, /against .* terms/i, /risk is accepted/i,
  /\bADRs?\s+(\d{4},?\s+(and\s+)?)*000[135]\b/i, /\b000[135]-(ai|dashboard)-/]) {
  assert.deepEqual(offenders(pattern, decisions), [], String(pattern));
 }
});

test('the retired merge gate is gone and no workflow names its secrets', () => {
 for (const path of ['.github/workflows/merge-gate.yml', '.github/workflows/merge-gate-reconcile.yml', 'gate']) {
  assert.equal(existsSync(path), false, path);
 }
 const pattern = new RegExp(piece('CLAUDE_CODE_', 'OAUTH_TOKEN', '|HERMES_MERGE_', 'GATE_'));
 assert.deepEqual(offenders(pattern, path => path.startsWith('.github/')), []);
});

test('the public tree deploys nothing of ours', () => {
 for (const path of ['.github/workflows/deploy-db.yml', 'docker-compose.prod.yml', 'scripts/deploy-db.sh', 'scripts/deploy-db-needed.mjs',
  'docs/deploy-db.md', 'tests/deploy-db-needed.test.mjs']) assert.equal(existsSync(path), false, path);
 const workflows = [...texts.keys()].filter(path => path.startsWith('.github/workflows/'));
 assert.ok(workflows.includes('.github/workflows/ci.yml'), 'the scan sees the workflows');
 const inWorkflows = path => path.startsWith('.github/workflows/');
 assert.deepEqual(offenders(new RegExp(piece('self-', 'hosted')), inWorkflows), [], 'self-hosted runner');
 assert.deepEqual(offenders(new RegExp(piece('\\benvironment', ':')), inWorkflows), [], 'deployment environment');
 assert.deepEqual(offenders(new RegExp(piece('\\bsecrets', '\\.(?!GITHUB_TOKEN\\b)')), inWorkflows), [], 'secret other than GITHUB_TOKEN');
 const ci = load(texts.get('.github/workflows/ci.yml'));
 for (const job of ['changes', 'static', 'integration', 'install', 'flaky-tests', 'check']) assert.ok(ci.jobs[job], job);
 for (const job of ['deploy', 'deploy-db']) assert.equal(ci.jobs[job], undefined, job);
 assert.deepEqual(ci.jobs.check.needs, ['changes', 'static', 'integration', 'install']);
});

test('no identifier of our own hosted instance', () => {
 assert.deepEqual(offenders(new RegExp(piece('veejdgl', 'tjyslfjdplqgf'))), [], 'Supabase project ref');
 assert.deepEqual(offenders(new RegExp(piece('services/', 'gtmworks'))), [], 'server deploy script path');
 assert.deepEqual(offenders(new RegExp(piece('~omar', '/'))), [], 'server home path');
 // The hosted domain is ours; examples use example.com, which is reserved for documentation.
 assert.deepEqual(offenders(new RegExp(piece('gtmworks', '\\.cloud\\b')), outsideReference), [], 'hosted domain');
});

test('the README install, update, backup and restore are the only way described to run gtmworks', () => {
 const pattern = new RegExp(piece('deploy', '-db|production environment|supabase cloud'), 'i');
 const docs = path => path === 'README.md' || path.startsWith('docs/');
 const outsideDecisions = offenders(pattern, docs).filter(line => !line.startsWith('docs/adr/'));
 assert.deepEqual(outsideDecisions, []);
 const readme = texts.get('README.md');
 for (const heading of ['Install', 'Update', 'Backup', 'Restore']) assert.match(readme, new RegExp(`^## ${heading}$`, 'm'), heading);
});

test('no link to a private place', () => {
 for (const pattern of [new RegExp(piece('omarabdo516/', 'aios-saas')), new RegExp(piece('kit', 'chen|hermes-', 'system|rs-', 'aios'), 'i')]) {
  assert.deepEqual(offenders(pattern), [], String(pattern));
 }
 // Issues and pull requests numbered below 284 belong to the private archive, whatever repository they are in.
 const old = /github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/(\d+)|\b[\w.-]+\/[\w.-]+#(\d+)\b/g;
 const links = [];
 for (const [path, text] of texts) {
  for (const match of text.matchAll(old)) if (Number(match[1] ?? match[2]) < 284) links.push(`${path}: ${match[0]}`);
 }
 assert.deepEqual(links, []);
});

test('no build-host detail outside the design reference', () => {
 // The Hermes address tests document private-range and tailnet literals on purpose: they prove such addresses are refused or allowed.
 const fixtures = new Set(['lib/hermes.mjs', 'tests/hermes-address.test.mjs', 'tests/fake-hermes.mjs']);
 const keep = path => outsideReference(path) && !fixtures.has(path);
 for (const pattern of [
  new RegExp(piece('/home/', 'omar')),
  /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
  /[\w-]+\.ts\.net\b/,
  /\bsrv\d{4,}\b/,
 ]) assert.deepEqual(offenders(pattern, keep), [], String(pattern));
});

test('the old evidence directory is gone with every reference to it', () => {
 assert.equal(existsSync('evidence'), false);
 assert.deepEqual(offenders(new RegExp(piece('evi', 'dence/')), outsideReference), []);
});

test('no phone number or personal email address', () => {
 // An international number (+country code, then 8 or more digits) or an Egyptian mobile number with or without its code.
 const phone = /(?<![\w)\]])\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b|\b(?:20)?01[0125]\d{8}\b|\b201[0125]\d{8}\b/;
 const personalEmail = /@(?:g(?:oogle)?mail|yahoo|hotmail|outlook|live|msn|icloud|me|aol|proton(?:mail)?|pm|ymail|gmx|yandex|zoho)\.[a-z]{2,}/i;
 assert.deepEqual(offenders(phone), [], 'phone');
 assert.deepEqual(offenders(personalEmail), [], 'personal email');
});
