// The required `check` job's verdict (.github/workflows/ci.yml), like Hermes `all-checks-pass` (#76). Classification
// and the fast job must succeed, and the fast job's steps (scripts/ci-fast.mjs, #258) are listed one by one: each must
// succeed, except the component tests, which pass skipped only when the first job did not ask for them. Each long suite
// the first job did not ask for (scripts/ci-areas.mjs) passes only when it was skipped; one it asked for, or whose need
// is unknown, must succeed. On a draft pull request every long suite passes only when it was skipped (#333). A failed or
// cancelled stage is always red.
const env = process.env;
// The compared screens are not a stage: they run on main only and never judge a pull request (#257).
const stages = ['DATABASE', 'INTEGRATION', 'INSTALL'];
const keys = ['DRAFT', 'CHANGES_RESULT', 'FAST_RESULT', 'COMPONENTS_RUN', ...stages.flatMap(stage => [`${stage}_RUN`, `${stage}_RESULT`])];
console.log(keys.map(key => `${key}=${env[key] ?? ''}`).join(' '));
const fast = new Map((env.FAST_STEPS ?? '').split(' ').filter(Boolean).map(pair => pair.split('=')));
if (fast.size === 0) console.log('fast: no step results');
for (const [step, result] of fast) console.log(`fast ${step}: ${result}`);
// The browser suite runs in shards (#335): each names its own pass, a slot left empty is a shard that failed, was
// cancelled or never ran, and integration is green only when the matrix and every one of its shards are.
const shards = (env.INTEGRATION_SHARDS ?? '').split(',');
console.log(`integration shards: ${shards.map((result, index) => `${index + 1}=${result || 'none'}`).join(' ')}`);
const expected = step => (step === 'components' && env.COMPONENTS_RUN === 'false' ? 'skipped' : 'success');
const passes = env.CHANGES_RESULT === 'success' && env.FAST_RESULT === 'success'
  && fast.size > 0 && fast.has('components') && [...fast].every(([step, result]) => result === expected(step))
  && stages.every(stage => env[`${stage}_RESULT`] === (env.DRAFT === 'true' || env[`${stage}_RUN`] === 'false' ? 'skipped' : 'success'))
  && (env.INTEGRATION_RESULT !== 'success' || shards.every(result => result === 'success'));
process.exit(passes ? 0 : 1);
