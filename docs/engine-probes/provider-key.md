# Can a Provider's API key be kept once, in the pinned Engine's root credential pool? (#936)

**Fail.** A key held once in the root profile's credential pool is read by every profile that holds none of its own
(questions 1–3), but a profile that still holds the same provider's key in its own `.env` — the state of every Agent
during the move — copies the pool key into its own `auth.json` on its first Run, and that copy outlives the removal of
both the `.env` key and the root's pool entry (question 5). So a removed or rotated key stays in every profile that ran
during the move: the key is not kept once, and keys should stay in each profile.

Measured on 2026-11-27 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, through the Engine's own HTTP routes only. The provider is
`deepseek` (an ordinary API-key provider, key `DEEPSEEK_API_KEY`); the fake model of `engine-stack/` stands in for its
endpoint by writing `model.base_url` on each profile, so no cloud address is reached.

Run it again with `sh docs/engine-probes/provider-key/run.sh` (a few minutes, most of it the Engine's own start and six
Runs). It stands up the throwaway Engine of `docs/engine-probes/engine-stack/` (#823), runs `provider-key/probe.mjs`,
prints the lines below and removes everything it made. An answer other than the one below exits non-zero with the
Engine's answer. `KEEP=1` leaves the stack up for another try.

# 1. What the Engine answered

| Question | Answer | Pass |
| --- | --- | --- |
| 1. Does a Run on a profile that holds no key of its own answer with a key held only in the root's pool? | **Yes.** `key-agent` holds no `DEEPSEEK_API_KEY` (its `/api/env` row `is_set: false`); a Run ended `completed` and the fake model saw the pool key (`Authorization: Bearer sk-probe-a-…`). | ✅ |
| 2. Is setting that profile's model to a model of that provider accepted, and does the space still list the provider's models? | **Yes.** `PUT /api/profiles/key-agent/model {provider, model}` answered `ok: true`; `GET /api/model/options?profile=key-space` still lists `deepseek` `authenticated: true` with `deepseek-flash`, `deepseek-v4-pro`. | ✅ |
| 3. Can a caller tell which providers hold a key without the reveal route, and does any answer carry the key or more than the redacted preview? | **Yes, and no.** `GET /api/credentials/pool` names `deepseek` with `token_preview: "sk-p…726b"` and no raw key anywhere; the reveal route (`POST /api/env/reveal`) answers 404 for the pool key on both `key-agent` and the root, because the key is in `auth.json`, not `.env`. | ✅ |
| 4. Does removing the pool entry stop the next Run on every profile, and does a second entry before the first is removed leave no Run without a key? | **Removing stops a profile with no own copy** (the next Run ended `failed`), **and the second-entry order leaves no gap** (a Run answered with `sk-probe-b-…`). It does **not** stop a profile that copied the key in question 5. | ⚠️ |
| 5. What does a profile do when it still holds the same key in its own environment: which one answers, and what happens when the environment's copy is removed? | **The pool key answers** (priority 0, before the `.env` key the Engine seeds at priority 1). **But the profile copies the pool key into its own `auth.json` on that Run**, and the copy answers even after both the `.env` key and the root's pool entry are removed. | ❌ |

All five holding is a pass; question 5 fails, so the probe fails.

# 2. The source behind each answer

- **Adding the key** takes a provider, a key and a label: `POST /api/credentials/pool` with `{provider, api_key, label}`
  (`hermes_cli/web_routers/ops.py:381`, `add_credential_pool_entry`; a `manual` `api_key` row). It targets the root
  profile with `?profile=default`.
- **A profile with no pool entry of its own reads the root's** (`hermes_cli/auth.py:934`, `read_credential_pool`):
  "the global-root auth.json is a read-only fallback applied per provider ONLY when the profile has zero entries for
  it". A Run reaches it through `resolve_runtime_provider` (`hermes_cli/runtime_provider.py:1044`), whose ladder
  (`_ladder_rungs:1111`) resolves the pool (`_resolve_from_pool:679`, `should_use_pool = provider != "openrouter"`)
  **before** the `.env`-key rung. That order is why the pool key answers before the profile's own `.env` key.
- **The list redacts**: `GET /api/credentials/pool` (`ops.py:352`) gives each row `token_preview: redact_key(token)`,
  never the key. **The reveal route** (`hermes_cli/web_routers/config_env.py:1099`, `reveal_env_var`) reads the
  profile's `.env` only, so a pool key is 404 there.
- **The model set** (`hermes_cli/web_routers/profiles.py:124`, `_write_profile_model`) and **the model options**
  (`hermes_cli/web_routers/models.py:139`, `get_model_options`, which lists a provider `authenticated` when the pool
  `has_credentials()` through the same fallback, `hermes_cli/models_detect.py:74`) carry the `deepseek` model.
- **Question 5's copy**: on the profile's first Run, `load_pool` (`agent/credential_pool.py:2977`) seeds the profile's
  `.env` key into the pool (`_seed_from_env:2860`) and, because the list changed, persists the whole pool — the borrowed
  root entry included — to the profile's own store (`_persist:1105`; `persist_pool_entries:872` writes a
  non-single-use-refresh provider to the active store). The profile then holds its own `manual` copy of the key, which
  `read_credential_pool` prefers ("profile wins when it has ANY entries"), and which outlives the removal of both keys.

# 3. What this means for the keys ticket

The read side works: a key held once in the root's pool answers for every profile that holds none (questions 1–3, and
question 4 for those profiles). The write side does not: during the move every Agent still holds the key in its own
`.env`, and the first Agent that runs copies the pool key into its own `auth.json`. That copy is stale — it is not
reached by a later removal or rotation — so the "set on four Agents out of five" problem the spec removes comes back.
Keys should stay in each profile, or the move must run with no profile holding both keys, which the Engine cannot
guarantee while work is in progress.

# 4. The run

```
engine nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
provider deepseek, key env DEEPSEEK_API_KEY, fake model at http://fake-model:8080/v1
the root's pool holds one deepseek entry: {"index":1,"id":"713351","label":"probe key a …","auth_type":"api_key","source":"manual","priority":0,"last_status":null,"request_count":0,"token_preview":"sk-p…726b","has_refresh":false}
the space's model options list deepseek: {"models":["deepseek-flash","deepseek-v4-pro"],"authenticated":true}; the probe uses model deepseek-flash
question 1: key-agent holds no DEEPSEEK_API_KEY (is_set false); a Run ended completed, output "q1 pool answers", sent with Bearer sk-probe-a-…
PASS question 1: a keyless profile answers with the key held only in the root's pool
question 2: setting key-agent's model to deepseek/deepseek-flash was accepted (PUT /api/profiles/<name>/model); the space still lists deepseek: {"models":["deepseek-v4-pro","deepseek-flash"],"authenticated":true}
PASS question 2: the model is accepted and the space still lists the provider's models
question 3: the pool read names deepseek with the redacted preview "sk-p…726b" and no raw key in the answer; the reveal route on key-agent (no env key) answered 404, on the root (the key is in its pool, not its .env) 404
PASS question 3: a caller tells which providers hold a key from the pool and env reads, and no answer carries the key or more than the redacted preview
question 4: with the pool entry removed, the next Run on key-agent (which never held a key) ended failed
question 4: a second entry added before the first is removed leaves the next Run answered: ended completed, sent with Bearer sk-probe-b-…
PASS question 4: removing the one entry stops the next Run, and a second entry added before the first is removed leaves no Run without a key
question 5: key-env holds DEEPSEEK_API_KEY in its own .env and the root's pool holds one; a Run ended completed and was sent with Bearer sk-probe-b-…
question 5: with the env copy removed the Run ended completed and was sent with Bearer sk-probe-b-…
question 5: with the root's pool entry removed too, the Run ended completed and was sent with Bearer sk-probe-b-…
FAIL question 5: the pool key answers first, but the profile copied it into its own auth.json on an earlier Run, and the copy outlives the removal of both keys (after the root's entry was removed the Run still ended completed, sent with Bearer sk-probe-b-…)

VERDICT: FAIL — question 5: the pool key answers first, but the profile copied it into its own auth.json on an earlier Run, and the copy outlives the removal of both keys (after the root's entry was removed the Run still ended completed, sent with Bearer sk-probe-b-…)
what it means: a key kept once in the root's pool is read by every keyless profile (questions 1-3), but a profile that still holds its own env key during the move copies the pool key into its own auth.json, and that copy outlives the removal of both keys. So a removed or rotated key stays in every profile that ran during the move: keys should stay in each profile, or the move must run with no profile holding both.
```
