import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The CI `install` job with its proof step's script read in: the step that runs scripts/ci-install-check.sh gets what it
// runs — the check with scripts/ci-install-lib.sh read in where it is sourced (#402) — so tests read the job as CI runs
// it, wherever the proof lives.
export function installJob() {
 const job=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install;
 const lib=readFileSync('scripts/ci-install-lib.sh','utf8');
 const script=readFileSync('scripts/ci-install-check.sh','utf8');
 const run=script.replace(/^\. "\$\(dirname "\$0"\)\/ci-install-lib\.sh"\n/m,()=>lib);
 return {...job,steps:job.steps.map(step=>step.run==='bash scripts/ci-install-check.sh'?{...step,run}:step)};
}
