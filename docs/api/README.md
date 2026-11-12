# Agent API v1

[OpenAPI 3.1 contract](openapi.yaml), document version **1.6.0**, under `/api/v1/companies/{slug}`. This is runtime-neutral HTTP; Hermes is the first client, not the protocol. The implemented routes are card list/create, edit, comment, upload, move/actor/assignee/label/check operations and run-key issue and revoke (`/cards/{card}/run-keys`) attachment download (`/cards/{card}/files/{file}`) and, for a run key only, `GET /skills` and `GET /skill-loads` (both read-only) and `POST /skills/{skill}/lessons`. No run record, company-chat, message-history, single-card read or MCP endpoint is implemented today.

Version policy: compatible additions increment the document minor version; corrections increment patch. Breaking changes require a new URL major version and an announced transition before old clients are removed. Document version 1.2.0 does not imply a runtime change. Paths marked `x-status: planned` are proposals, not callable operations; their schemas and authentication will be settled with implementation. Current unknown routes are refused (403), not a run API. Planned run creation/claim/heartbeat/completion must enforce company grants, expiring card/run credentials and fenced leases ([ADR 0006](../adr/0006-agent-identities-company-grants-and-card-scoped-runs.md)).

Authentication uses a bearer key. Keys carry a prefix that says what they are, are shown once, and are stored only as a SHA-256 hash that is compared in constant time; each records `issued_at` and `last_used_at`. Who is acting always comes from the key, never from the request body.

- **Company key** (`gtmw_agt_`): bound to a company and an active Contributor member. It has no expiry, is revoked by an Owner, and, when the key belongs to a shared role agent, works only while that agent holds an active company grant (#77). A live role-agent key whose grant was revoked, or never given, receives 404 `not found` on every route of that company, as does a key used against another company's slug.
- **Run key** (`gtmw_run_`): issued for one card by `POST /cards/{card}/run-keys`, called with a company key of an agent the card is assigned to (next actor or assignee). Assigning a card (next actor or assignee) to an agent makes it eligible for a run key for that card, delivered one of two ways. **Push:** when the company has a webhook, the delivery of the `assigned` event carries `run_key` (`key` and `expires_at`, one hour), added when the request is signed and sent, over HTTPS only (plain HTTP is allowed to localhost for development; a delivery to any other `http:` address fails without issuing a key). A key is issued only while the agent still holds a live company key, so a delivery retried after an Owner revoked it issues nothing. **Pull:** without a configured webhook nothing is delivered, and the agent asks for its key with `POST /cards/{card}/run-keys`, using its company key. That request succeeds for a card currently assigned to the calling agent (next actor or assignee), whether or not the company has a webhook, and returns 403 for any other card ([ADR 0007](../adr/0007-run-keys-are-pushed-by-webhook-or-pulled-by-the-assigned-agent.md)). The key is never stored or logged; a retry of the delivery issues a fresh key. `assigned` has `company`, `card`, `agent` (id, name), `card_path` and `card_url`. The body of the request may carry `ttl_seconds` (1 to 86400, default 3600). The response `{key, card, expires_at}` shows the key once. A run key reads and writes its own card only: any other card, card creation and key issue return 403. It can end itself with `DELETE /cards/{card}/run-keys` (a company key of the agent ends all of its run keys for the card the same way). It stops with 401 when it expires, when it is revoked, when an Owner revokes the agent's company key, or when the agent's company grant is revoked (the revoke also marks the key revoked, so a later grant does not bring it back). The Owner list under Team > Agents shows company keys only.
- **Legacy key** (`agt_`): the company keys made before run keys. They keep working during the transition and every response to one carries `Deprecation: true` and `X-GTMWorks-Key: legacy`. Removal will be announced before a breaking API version.

Every authentication failure (no key, unknown key, revoked, expired, a key of the wrong kind) returns the same 401 body `{"error":"unauthorized"}`. Never send model credentials to gtmworks. The API server requires `SUPABASE_SERVICE_ROLE_KEY` for key lookup and rate accounting, and `SUPABASE_JWT_SECRET` to sign five-minute internal member JWTs. Neither value is sent to a client. Card queries use the public key and that member JWT. These values must be supplied by the deployment environment.

Writes use JSON (except multipart uploads/comments) and require `Idempotency-Key` of 1–200 characters, scoped to company and member. Retry identical method, relative path and body bytes; changed input returns 409. Card creation accepts `title`, `stage`, optional `template` and `evidence`. It also accepts `message`, `agent` (the person ID of a role agent the company has granted) and `mode` (`plan`, `do` or `answer`) instead: that creates the card in the company's Ideas stage with its first message and its assignment together, once per idempotency key; an agent that the company has not granted (or whose grant was revoked) is `404`, an unknown mode or an empty message is `400`. Card edits accept `fields` and optional `evidence`; `fields.project_id` files the card into a project of the same company (a project of another company is `404`, an empty value takes the card out of its project). Move accepts `stage`; actor and assignee accept `person`; label accepts `label`; check accepts `item` and `done`; comment accepts `body`. Each also accepts `evidence` text, without URI validation. Create returns `{id}`; edit/move return `{}`; actor/check return `{id:null}`; other writes return the inserted row ID as `{id}`. Uploading a new creative returns its creative ID; uploading to an existing creative returns the version ID.

For local development, `npm run dev` starts the webhook worker alongside the web process. The local seed includes the public fixture key `agt_local_fixture_for_tests_only`; it is not a production credential. Set a distinct random 32-byte base64 `WEBHOOK_ENCRYPTION_KEY`, `APP_ORIGIN`, and the database credentials in other environments. Run `npm run worker` as a separate process in production. Replacing the encryption key requires re-entering webhook secrets.

`POST /cards/{card}/upload` accepts multipart `file`, optional existing `creative` ID and optional `evidence`; the maximum file size is 20 MiB. Retries must use the same idempotency key and file contents.

A webhook body contains `company` (id, slug, name), `card` (ID), `event_type` (`approved`, `rejected`, or `commented`), `actor` (id and name), `reason`, `marked_parts` (`caption`, `design`), `comment`, `card_path` and absolute `card_url`. `X-GTMWorks-Signature` is `sha256=` followed by the hex HMAC-SHA256 of the exact request body. `X-GTMWorks-Delivery` identifies the delivery; receivers should deduplicate it because retries are at least once. Network failures and non-2xx responses retry with exponential backoff, capped at an hour, for up to 24 hours. API errors are JSON objects with an `error` field; invalid keys return 401, forbidden operations return 403, inaccessible companies return 404, and rate limits return 429 with `Retry-After`.

People attach files and reference images to a card's first message and to their replies. The card list returns them as `attachments` (`id`, `comment_id`, `name`, `content_type`, `size`, `created_at`) and `GET /cards/{card}/files/{file}` returns the bytes. A run key reads the files of its own card only (403 for any other card); a file of another card or company is 404. Raster images are returned with their type and every other file as `application/octet-stream` with `Content-Disposition: attachment`.

`POST /cards/{card}/comment` accepts JSON with `body` and an optional evidence link, or multipart form data with `body` and a `file` of up to 20 MiB. The file is stored privately and the card activity provides a time-limited download link. Retries require the same idempotency key and contents.

## Planned run endings and human waits (#125)

These names are borrowed from the **AG-UI 1.0 protocol** for compatibility.
gtmworks takes no AG-UI dependency and makes no conformance claim. Only the names
for run endings and interrupts are borrowed: agents still claim runs and write
through this API; gtmworks does not call or execute an agent. All run routes stay
`x-status: planned`, pending #83. This adds no deployed route or webhook field.

A planned run has one of six statuses:

| Status | Meaning |
| --- | --- |
| `queued` | Waiting for an agent to claim the work. |
| `running` | The agent is working under a fenced lease. |
| `waiting` | The run delivered a version or asked a question and awaits a person. |
| `done` | The run finished successfully. |
| `failed` | The run ended with an error. |
| `cancelled` | A person or gtmworks stopped the run. |

The planned `POST /runs/{run}/complete` body reports `outcome`: `success` becomes
`done`, `interrupt` becomes `waiting`, `cancelled` becomes `cancelled`, and `error`
becomes `failed`. An `interrupt` outcome requires a nonempty `interrupts` array.
Each entry carries `id`, `reason` (`version_approval` or `question`), `message`,
`responseSchema` (the JSON Schema for the expected answer), and `expiresAt` (a
date-time). A version approval also requires `versionId`, the exact version ID;
its `id` equals that same integer. A question may omit `versionId`. An agent only
reports that it is waiting. It never records an answer, approves, rejects,
publishes or spends.

Answers will reach the agent as `resume` entries `{interruptId, status, payload}`.
`interruptId` matches the original interrupt; `status` is `resolved` for a person's
answer or `abandoned` when the wait is closed without an answer. A resolved payload
matches `responseSchema`; an abandoned payload is `null`. Resolved does not mean
approved: a rejection is also an answer. Delivery is planned as a `resume` array
in the existing `approved`/`rejected`/`commented` webhook and in the next run's
payload on the same card. Today's webhook body above is unchanged.

**No answer is never yes.** A run cannot continue past an open interrupt until it
is answered or abandoned. Abandoning a wait authorizes no approval, publishing or
spending. The planned watchdog (#84) ignores missed heartbeats and lease timeouts
for `waiting` runs; it may fail a waiting run only after an open interrupt's
`expiresAt` passes. Expiry supplies no answer or approval. Explicit retry and the
next run stay on the same card; fresh work needs valid company/card/run authority.

## Skills (#93)

A run reads its skills with its run key. `GET /skills` returns `{skills}`: the latest stored version of each skill a person enabled for the calling agent in this company, with `slug`, `version`, `name`, `description`, `permissions`, the SKILL.md `content` and its `sha256`. It is the only way an agent receives skill instructions: they come from the stored skill, never from a card, a comment or any request field. Each read is recorded against the run key, and `GET /skill-loads` returns `{loads}`, the `slug`, `version`, `sha256` and `loaded_at` of every skill version that run has loaded, so a run can show which versions it followed. A second run starts with its own empty history. A company key is not a run: it asks for a run key (`POST /cards/{card}/run-keys`) and gets 403 on both routes, as does an expired or revoked run key (401). An agent never installs or enables a skill; people do, on Team > Skills.

## Lessons (#94)

A run proposes what it learned as one addition to one of its skills: `POST /skills/{skill}/lessons` with `{lesson, reason}` and an `Idempotency-Key`, using its run key. The card is the run's own card, so the proposal always names the card it was learned on. It returns `{id, status}` with status `pending` and appears in the Inbox of people who manage the company, showing the change to the skill, the reason and the card. Nothing is written to the skill until one of them approves it; approval adds the lesson as the last bullet of the skill's Lessons section and stores the result as the skill's next version, which the next run reads through `GET /skills`. A rejected lesson is never added. An agent cannot approve or reject, a company key gets 403, an unknown or not-enabled skill is 404, an empty or over-long lesson or reason is 400, and at most ten proposals wait at once for one skill from one agent.
