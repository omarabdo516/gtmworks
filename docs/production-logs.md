# Reading what production reports

A symptom that appears only on the live site is read from its container log, not guessed. Every line below is one JSON object
in `docker compose --env-file .env.install -f docker-compose.install.yml logs web`, run from the install directory. Secret-looking values (the exact value of any setting named like a key, secret, token or
password, anything shaped like a token, and short digit runs such as authenticator codes) are replaced by `[redacted]`.

- `"event":"server_action_failed"`: a server action threw (`"outcome":"threw"`) or handled a failure and showed a message
  (`"outcome":"returned"`). Fields: `action`, `company` and `slug` (from the action's own form, so a company's failures carry the company; empty for actions that belong to no company), `status`, `errorClass`, `code`, `message`. Redirects are not failures.
- `"event":"client_error"`: the browser reported an error from one of our pages to `POST /api/client-errors` (at most 60 a
  minute). Fields: `source` (`page`, `promise`, `error-page`, `server-action`), `path` (no query), `stage`, `status`, `code`, `message`, `stack`. Never input values.
- `"event":"chat_opened"`: one line per chat opened (`/c/<slug>/conversations/<id>`), written once its response has gone.
  Fields: `company`, `conversation`, and `ms`, each step's elapsed milliseconds from the page's start: `frame` (sign-in,
  Companies and the Conversation), `reads` (the page's other reads), `details` (the Agent's details), `sidebar` (the
  Shell's reads), `firstByte` (the frame is drawn and its first bytes leave), `session` (the Hermes session read), `record`
  (the transcript's reads) and `done`. A step that did not run is left out. Never a body or a key.
- `"event":"agent_setting_saved"`: one line per `POST /api/agent-settings` (an Agent's or the Company's model, sub-agents
  or other Engine setting, or a learning mode), written once its answer has gone. Fields: `company`, `setting` (the
  setting's name, `settings` for several at once, `learning` for a mode), `status` (the answer's HTTP status) and `ms`,
  each step's elapsed milliseconds from the request's start, so a step's own time is its mark less the one before it:
  `signIn`, `allowed` (the route's Role check), `queue` (the wait behind the Company's other setting writes), `owner`
  (the Owner check, for one setting), then for a model only `reads` (the Providers, the Agents and the Engine's profile
  list, read side by side), `engineWrite` (every profile's write and read-back) and `record` (the choice and the Company
  log), and `done`. A step that is not marked is left out. Never a value, a body or a key.

New server actions are exported as `export const name=withActionLog('name',async function name(...){...})`; a unit test fails
for one that is not.
