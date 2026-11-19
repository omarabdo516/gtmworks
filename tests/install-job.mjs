import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The install proof is one job of one matrix entry per area (#406). A test that reads the proof's text reads all of it
// here, as one step: the whole `scripts/ci-install-check.sh` with `scripts/ci-install-lib.sh` read in where it is
// sourced, with the steps the job has around it — the isolated Docker machine, Node, the browser check's test packages,
// the image loaded from the run's one build — so a check reads the same text wherever its area now runs.
export function installJob() {
  const job = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.install;
  const lib = readFileSync('scripts/ci-install-lib.sh', 'utf8');
  const script = readFileSync('scripts/ci-install-check.sh', 'utf8');
  const run = script.replace(/^\. "\$\(dirname "\$0"\)\/ci-install-lib\.sh"\n/m, () => lib);
  return {
    ...job,
    steps: job.steps.map(step => (step.name === 'the install proof' ? { ...step, run } : step)),
  };
}
