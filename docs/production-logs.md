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
  Shell's reads), `firstByte` (the frame is drawn and its first bytes leave), `record` (the transcript's reads) and `done`. The Hermes
  session is no step of an open since #766: the steps under the replies are their own request after the page is drawn. A step that did not run is left out. Never a body or a key. `render` (#762) says
  what the render was: `open` (a person opened the page), `prefetch` (a link drew it ahead of a press) or `refresh` (the
  page the browser already showed, drawn again); only `open` lines measure what a person waited for.
- `"event":"engine_state"`: a listener of a Company's Engine changed its health (#772, #781), written by the one
  transport (`lib/engine/transport.mjs`) for every caller, the web and the worker: one line per change of state, never
  one per call. Fields: `engine` (its host and port), `listener` (`api` or `management`), `state` (`slow`: a call timed
  out; `down`: nothing could connect; `up`: it answers again) and `cause` (`timedOut`, `refused`, `nameNotFound`,
  `noNetwork` or `failed`; null when `up`). A slow listener is asked one call at a time, after a wait of 250 ms that
  doubles with each timeout in a row up to 8 s (the Run lifecycle's calls, a Run's start, record, events, answer, permission and stop, go at their turn without it); a down one is asked one call at a time with no wait. A slow Engine reads
  `timedOut`, never unreachable. The worker leaves an Engine whose write failed out of its upkeep after 2 s, then 4 s,
  and so on up to five minutes. It writes an Agent's rules and its Company's shared Skills only when they changed since
  its own last write, and reads every profile once every five minutes for drift.
- `"event":"apps_unread"`: an Agent's apps that could not be listed for its Connected tools (#770), one line per failed
  read. Fields: `company`, `agent`, `cause` (`unreachable`, `timedOut`, `refused`, `noNetwork`, `errorAnswer`, `failed`,
  `noProfile`, `database`, `missing`). The page keeps the last good list it read in the last minute and reads again.
- `"event":"message_drawn"`: from a person pressing Send in a Conversation until their own message was drawn, measured
  by their browser and reported to `POST /api/waits` (#762). Fields: `company`, `conversation`, `ms`. At most 120 lines
  a minute from the browser's reports; never a message's text.
- `"event":"run_started"`: from a message being stored until the Engine started its Run, written by the one starter of
  a Conversation's turns once the Run is recorded (#762). Fields: `company`, `conversation`, `ms`.
- `"event":"reply_drawn"`: from a Run's end until its reply was drawn in the person's browser, reported to
  `POST /api/waits` (#762). Fields: `company`, `conversation`, `ms`, and `from`: `stream` when the end is the moment the
  Steps stream said the Run ended, `stored` when no stream was read and the reply's own stored time is used.
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
