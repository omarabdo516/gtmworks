// What looks like a secret in text a person writes for the Agents (a Member's note). The database refuses the same
// patterns (public.secret_like, latest in supabase/migrations/20261211000001_team_work_retries.sql); tests/secret-text.test.mjs keeps
// the two lists equal. The form checks first so the person sees why before anything is sent.
export const caseSensitive = [
  'sk-[A-Za-z0-9_-]{20,}',
  '(gtmw_agt_|gtmw_run_|agt_)[A-Za-z0-9_-]{16,}',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'github_pat_[A-Za-z0-9_]{20,}',
  'xox[abprs]-[A-Za-z0-9-]{10,}',
  'AKIA[0-9A-Z]{16}',
  'AIza[0-9A-Za-z_-]{35}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
];
export const caseInsensitive = [
  // A key named password, secret, token and the like with a value: any quoted value (spaces and short ones too), or an
  // unquoted one of four or more characters (JSON, YAML, .env).
  '(password|passwd|pwd|passphrase|secret|api[ _-]?key|access[ _-]?key|access[ _-]?token|auth[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|token)["\']?\\s*[:=]\\s*("[^"]+"|\'[^\']+\'|["\']?[^\\s"\'][^\\s]{3,})',
  // A user and password inside an address (postgresql://user:password@host).
  '[a-z][a-z0-9+.-]*://[^\\s/:@]+:[^\\s/@]+@',
  'bearer\\s+[A-Za-z0-9._~+/-]{20,}',
  // Arabic words for a password with a value, quoted or not, as above (also the Egyptian spellings: ha for the final ta marbuta, a doubled waw), as regex escapes (both engines read \uXXXX), so no interface text is in the source.
  '(\\u0643\\u0644\\u0645[\\u0629\\u0647] (\\u0627\\u0644\\u0633\\u0631|\\u0627\\u0644\\u0645\\u0631\\u0648\\u0631)|\\u0628\\u0627\\u0633\\u0648+\\u0631\\u062f)["\']?\\s*[:=]\\s*("[^"]+"|\'[^\']+\'|["\']?[^\\s"\'][^\\s]{3,})',
];
const patterns = [...caseSensitive.map(source => new RegExp(source, 'u')), ...caseInsensitive.map(source => new RegExp(source, 'iu'))];
/** @param {string} text */
export const secretLike = text => patterns.some(pattern => pattern.test(text));
// The longest note a Member may keep.
export const noteLimit = 4000;
