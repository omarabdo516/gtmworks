import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The install proof is one job of one matrix entry per area (#406), and the measurement a job of its own (#408). A test
// that reads the proof's text reads all of it here, as one step: the whole `scripts/ci-install-check.sh` with
// `scripts/ci-install-lib.sh` read in where it is sourced, with the steps the job has around it — the isolated Docker
// machine, Node, the browser check's test packages, the image loaded from the run's one build — so a check reads the
// same text wherever its area now runs.
//
// The machine and the image are one composite action both jobs use (#411): a test that reads the job's steps reads the
// action's steps where the job uses it, so the start, the download and the load are found beside the proof as before.
const machine = load(readFileSync('.github/actions/install-machine/action.yml', 'utf8')).runs.steps;

export function jobSteps(job) {
  return job.steps.flatMap(step => (step.uses === './.github/actions/install-machine' ? machine : [step]));
}

export function installJob() {
  const job = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.install;
  const lib = readFileSync('scripts/ci-install-lib.sh', 'utf8');
  const script = readFileSync('scripts/ci-install-check.sh', 'utf8');
  const run = script.replace(/^\. "\$\(dirname "\$0"\)\/ci-install-lib\.sh"\n/m, () => lib);
  return {
    ...job,
    steps: jobSteps(job).map(step => (step.name === 'the install proof' ? { ...step, run } : step)),
  };
}
