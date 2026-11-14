// The required `check` job's verdict (.github/workflows/ci.yml). Exits 0 only when every stage that had to run passed:
// a document-only change skips both long stages; otherwise integration must succeed, and install must succeed unless
// this is a pull request that changes no install file (scripts/install-related.mjs), where a skipped install is
// allowed (#69). A failed or cancelled stage is always red.
const env = process.env;
console.log(['EVENT_NAME', 'CHANGES_RESULT', 'DOCS_ONLY', 'INSTALL_RELATED', 'STATIC_RESULT', 'INTEGRATION_RESULT', 'INSTALL_RESULT'].map(key => `${key}=${env[key] ?? ''}`).join(' '));
function passes() {
  if (env.CHANGES_RESULT !== 'success' || env.STATIC_RESULT !== 'success') return false;
  if (env.DOCS_ONLY === 'true') return env.INTEGRATION_RESULT === 'skipped' && env.INSTALL_RESULT === 'skipped';
  if (env.DOCS_ONLY !== 'false' || env.INTEGRATION_RESULT !== 'success') return false;
  if (env.INSTALL_RESULT === 'success') return true;
  return env.INSTALL_RESULT === 'skipped' && env.EVENT_NAME === 'pull_request' && env.INSTALL_RELATED === 'false';
}
process.exit(passes() ? 0 : 1);
