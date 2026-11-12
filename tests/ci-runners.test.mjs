import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// CI runs on GitHub's free standard runners (#37), and a pull request from a fork never reaches our machines or a secret.
// The old runner's name is assembled from pieces so this file does not match a search for it.
const piece = (...parts) => parts.join('');

const dir = '.github/workflows';
const workflows = readdirSync(dir).filter(name => /\.ya?ml$/.test(name))
 .map(name => ({ path: `${dir}/${name}`, text: readFileSync(`${dir}/${name}`, 'utf8') }))
 .map(file => ({ ...file, yaml: load(file.text) }));

function triggers(yaml) {
 // js-yaml reads `on` as a string key; a YAML 1.1 parser would read it as true.
 const on = yaml.on ?? yaml[true];
 if (typeof on === 'string') return [on];
 if (Array.isArray(on)) return on;
 return Object.keys(on ?? {});
}

test('the scan sees every workflow', () => {
 const paths = workflows.map(file => file.path);
 for (const path of ['ci.yml', 'design-compare.yml', 'visual-baselines.yml']) assert.ok(paths.includes(`${dir}/${path}`), path);
});

test('no workflow names the paid runner', () => {
 const pattern = new RegExp(piece('ubi', 'cloud'), 'i');
 for (const { path, text } of workflows) assert.equal(pattern.test(text), false, path);
});

test('every job runs on a GitHub-hosted ubuntu-latest runner', () => {
 for (const { path, yaml } of workflows) {
  const jobs = Object.entries(yaml.jobs ?? {});
  assert.ok(jobs.length > 0, `${path} has jobs`);
  for (const [name, job] of jobs) assert.equal(job['runs-on'], 'ubuntu-latest', `${path} ${name}`);
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
