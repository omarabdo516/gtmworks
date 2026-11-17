// The required `check` job's verdict (.github/workflows/ci.yml), like Hermes `all-checks-pass` (#76). Classification
// and static must succeed. Each long suite the first job did not ask for (scripts/ci-areas.mjs) passes only when it was
// skipped; one it asked for, or whose need is unknown, must succeed. A failed or cancelled stage is always red.
const env = process.env;
// The compared screens are not a stage: they run on main only and never judge a pull request (#257).
const stages = ['COMPONENTS', 'DATABASE', 'INTEGRATION', 'INSTALL'];
const keys = ['CHANGES_RESULT', 'STATIC_RESULT', ...stages.flatMap(stage => [`${stage}_RUN`, `${stage}_RESULT`])];
console.log(keys.map(key => `${key}=${env[key] ?? ''}`).join(' '));
const passes = env.CHANGES_RESULT === 'success' && env.STATIC_RESULT === 'success'
  && stages.every(stage => env[`${stage}_RESULT`] === (env[`${stage}_RUN`] === 'false' ? 'skipped' : 'success'));
process.exit(passes ? 0 : 1);
