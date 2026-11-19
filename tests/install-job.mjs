import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The CI `install` job with each step's script read in: a step that runs a part of scripts/ci-install-check.sh gets that
// part's text as its `run`, so tests read the job as CI runs it, wherever its script lives.
export function installJob() {
 const job=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install;
 const script=readFileSync('scripts/ci-install-check.sh','utf8');
 const part=name=>{
  const lines=script.split('\n'); const start=lines.indexOf(`${name})`);
  if(start<0) throw new Error(`no part ${name} in scripts/ci-install-check.sh`);
  return lines.slice(start+1,lines.indexOf(';;',start)).join('\n');
 };
 return {...job,steps:job.steps.map(step=>{
  const named=/^bash scripts\/ci-install-check\.sh ([a-z-]+)$/.exec(step.run||'');
  return named?{...step,run:part(named[1])}:step;
 })};
}
