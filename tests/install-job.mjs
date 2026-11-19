import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The install proof is four jobs, each one area (#406). A test that reads the proof's text reads all of it here, as one
// step: the whole `scripts/ci-install-check.sh` with `scripts/ci-install-lib.sh` read in where it is sourced, with the
// steps every install job has around it — the isolated Docker machine, Node, the browser check's test packages, the
// image loaded from the run's one build — so a check reads the same text wherever its area now runs.
export function installJob() {
  const jobs = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs;
  const job = jobs['install-first'];
  const lib = readFileSync('scripts/ci-install-lib.sh', 'utf8');
  const script = readFileSync('scripts/ci-install-check.sh', 'utf8');
  const run = script.replace(/^\. "\$\(dirname "\$0"\)\/ci-install-lib\.sh"\n/m, () => lib);
  const proof = job.steps.findIndex(step => (step.run ?? '').startsWith('bash scripts/ci-install-check.sh '));
  // Only the proxy area runs the sign-in page in Playwright, so its packages are a step of that job alone.
  const packages = jobs['install-proxy'].steps.find(step => step.name === 'test packages for the install browser check');
  return {
    ...job,
    steps: [
      ...job.steps.slice(0, proof),
      packages,
      { ...job.steps[proof], run },
      job.steps.at(-1),
    ],
  };
}
