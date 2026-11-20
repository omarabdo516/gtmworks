// The required `check` job's verdict (.github/workflows/ci.yml), like Hermes `all-checks-pass` (#76). Classification
// and the fast job must succeed, and the fast job's steps (scripts/ci-fast.mjs, #258) are listed one by one: each must
// succeed, except the component tests, which pass skipped only when the first job did not ask for them. Each long suite
// (scripts/ci-areas.mjs) passes only when it was skipped because the first job did not ask for it; one it asked for, or
// whose need is unknown, must succeed. The app image is one of them (#403): it runs when the browser suite or the install
// proof is asked for, and a failed or cancelled build is red, so nothing merges on a suite that never got its image. The
// install proof is one stage (#406): its job runs one matrix entry per area, so that one result is red when any area
// failed or was cancelled — GitHub's own result for the matrix, with fail-fast off — and it is skipped only when the
// install proof was not asked for. The chat's open time is one stage (#421): its job runs with a machine to itself
// whenever the browser suite is asked for, and it is skipped only when the browser suite is not. A draft pull request
// runs what a ready one runs (#405, replacing the draft rule
// of #333), so there is no draft state to read: a suite a draft's files need must succeed like any other. A failed or
// cancelled stage is always red.
const env = process.env;
// The compared screens are not a stage: they run on main only and never judge a pull request (#257).
const stages = ['IMAGE', 'DATABASE', 'INTEGRATION', 'CHAT_OPEN', 'INSTALL'];
const keys = ['CHANGES_RESULT', 'FAST_RESULT', 'COMPONENTS_RUN', ...stages.flatMap(stage => [`${stage}_RUN`, `${stage}_RESULT`])];
console.log(keys.map(key => `${key}=${env[key] ?? ''}`).join(' '));
const fast = new Map((env.FAST_STEPS ?? '').split(' ').filter(Boolean).map(pair => pair.split('=')));
if (fast.size === 0) console.log('fast: no step results');
for (const [step, result] of fast) console.log(`fast ${step}: ${result}`);
const expected = step => (step === 'components' && env.COMPONENTS_RUN === 'false' ? 'skipped' : 'success');
const passes = env.CHANGES_RESULT === 'success' && env.FAST_RESULT === 'success'
  && fast.size > 0 && fast.has('components') && [...fast].every(([step, result]) => result === expected(step))
  && stages.every(stage => env[`${stage}_RESULT`] === (env[`${stage}_RUN`] === 'false' ? 'skipped' : 'success'));
process.exit(passes ? 0 : 1);
