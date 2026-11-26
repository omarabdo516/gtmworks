# Does the pinned Engine's own dashboard open behind gtmworks's sign-in, for an Owner of that Company only? (#826, #827)

**Yes for every request, with one gap the gateway must close: a socket opened before the Owner's Role is taken away
keeps working.** Measured on 2026-11-26 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, unmodified, behind the install's pinned gateway
`nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284`.

An active Owner of Company A opens that Company's dashboard at `/engine/rs-learning/`, pages inside it included, in
gtmworks's colours with no choice made, and its live parts work through the gateway. A Manager, a Contributor, a Viewer,
an Owner of Company B only and a signed-out person each get the missing-page answer, on the page and on an API route.
The browser never holds the Engine's key. Once the Owner's Role is changed to Manager, the page, every API route, a
fresh WebSocket ticket and a ticket minted before the change are all refused. But the sockets the dashboard had already
opened (the board's event stream, the chat and its terminal) stay open and keep working, because the gate is asked at
the upgrade only. The pass line of #826 asks that nothing works after the change, so that is the gap. It is the
gateway's to close, not Hermes's. The second way in, Hermes's OIDC sign-in plugin, fails at its first step.

Run it again with `sh docs/engine-probes/engine-dashboard/run.sh` (a few minutes; the first run builds the install's Work
sandbox image), with the local gtmworks stack up (`bash scripts/local-db.sh`). A step that gets another answer than the
one below exits non-zero with what it got. Screenshots go to `$TMPDIR/engine-dashboard-shots/`.

# 1. How it was measured

- **The Engine** is the throwaway Engine of `docs/engine-probes/engine-stack/` (#823) started as the install starts a
  Company's Engine, with the Company's Work sandbox beside it exactly as `scripts/engine-template.yml` wires it: the
  install's own sandbox image (`sandbox/Dockerfile`), the managed `ssh` backend (`scripts/engine-managed.yml` at
  `/etc/hermes/config.yaml`) and the file-sync hook, on a work network with no route out. No Engine port is published.
- **The gateway** is the install's nginx image with one probe location (`gateway.conf.template`): `/engine/rs-learning/`
  goes to the Engine's management listener with `X-Forwarded-Prefix: /engine/rs-learning`, the Engine's key added as
  `Authorization: Bearer` by the gateway, the browser's cookies dropped, and WebSocket upgrades passed on. It is
  published on `127.0.0.1` only.
- **The gate** (`gate.mjs`) stands in for the check the Owner's dashboard spec builds: nginx's `auth_request` asks it
  about every request, upgrades included. It reads the person's gtmworks session from the cookie the app's own sign-in
  sets (`sb-<ref>-auth-token`, `@supabase/ssr`) and asks gtmworks's own rule, `public.is_company_owner(company)`, with
  that person's session, against the local gtmworks stack (its GoTrue and its `members` table). Anything but `true` is
  the missing-page answer (ADR 0004).
- **Not the install proof's machine.** #826 names the install proof's stack. The parts that decide this answer are the
  real ones here (the pinned Engine and sandbox as the template runs them, the install's gateway image, gtmworks's
  sign-in and Roles), but the gtmworks app is the local stack's, not an installed one, and the gate is the probe's,
  because the Owner's dashboard spec has not built gtmworks's. The install's own backup and restore, which need a real
  install, ran on one (`plugin-tool/install-backup.sh`, Probe C).
- **The people**: an Owner of A and an Owner of B only, made by the probe in the local stack and removed at its end, and
  the seed's Manager, Contributor and Viewer of A (`supabase/seed.sql`).
- **The browser**: Chromium, signed in with the Owner's cookie, through the gateway only.

# 2. Who gets in

| Who | First page | An API route (`/api/status`) | Same as the missing page |
| --- | --- | --- | --- |
| an active Owner of Company A | 200 | 200 | — |
| a Manager of A | 404 | 404 | yes |
| a Contributor of A | 404 | 404 | yes |
| a Viewer of A | 404 | 404 | yes |
| an Owner of Company B only | 404 | 404 | yes |
| a signed-out person | 404 | 404 | yes |

The missing page is what the gateway answers for `/engine/no-such-company/`, byte for byte. The gate decided 206
requests allowed and 16 refused, 6 WebSocket upgrades allowed and 1 refused.

# 3. The two ways the Engine offers

| Way | Result | Where it stopped, with the Engine's answer |
| --- | --- | --- |
| Its support for a reverse proxy at a sub-path (`X-Forwarded-Prefix`, `hermes_cli/web_server_dashboard.py`, `mount_spa`), the gateway adding the Engine's key | **passes**, with one gateway rule | the first page's HTML and CSS are rewritten under the prefix, but the dashboard's lazily loaded pages ask for their code at the root, `/assets/<chunk>.js`: through the prefix alone the second page answered 404 for 8 chunks. The gateway serves `/assets/` too, to the Owner of the page that asked for it (`Referer`), and then every page loaded with no error. |
| Its sign-in gate with an auth provider plugin (`plugins/dashboard_auth/self_hosted`, OpenID Connect) pointed at gtmworks's sign-in (GoTrue v2.197 publishes discovery) | **fails at its first step** | started with `HERMES_DASHBOARD_OIDC_ISSUER=http://<gtmworks sign-in>/auth/v1`: `SelfHostedOIDCProvider construction failed: OIDC issuer must be https:// (or http on localhost)`, `GET /api/auth/providers` → `{"providers":[]}`, `GET /auth/login?provider=self-hosted` → 404 `Unknown provider: 'self-hosted'`. Behind it two more stops: the Engine's network has no route to gtmworks's sign-in (a request from inside the Engine timed out), as ADR 0018 keeps it; and GoTrue's OAuth server is off (`/auth/v1/oauth/authorize` → 404 `feature_disabled`). Even working, it would only say who the person is, not that they are an Owner of this Company, and the Engine's own session would outlive the Role. |

# 4. What the browser holds

| Credential | Where | The Engine's own key? | After the Role is changed to Manager |
| --- | --- | --- | --- |
| gtmworks's session cookie `sb-127-auth-token` | cookie, set by gtmworks's sign-in | no | still a valid gtmworks session, but the gate refuses it for the dashboard: page 404, `/api/status` 404, `/api/config` 404 |
| WebSocket tickets (`?ticket=` on `/api/ws`, `/api/events`, `/api/pty`, `/api/plugins/kanban/events`) | addresses | no: the Engine mints them, 30 s, single use (`POST /api/auth/ws-ticket`) | a new one: 404. One minted before the change, used on a new socket: refused at the gateway |
| `hermes.pty.token.chat` | sessionStorage | no: the chat terminal's channel | only usable on a new `/api/pty` socket, which the gate refuses |
| `hermes-dashboard-theme: gtmworks` | localStorage | not a credential | — |
| **Sockets already open**: the board's two event streams, `/api/ws`, `/api/events`, `/api/pty` | the open page | — | **still open and still working**: the board's stream delivered the Card made after the change (+2 frames), and keys typed into the chat's terminal after the change were answered (+21 frames) |

`window.__HERMES_SESSION_TOKEN__` is absent (the dashboard runs gated and withholds it), the dashboard set no cookie,
and the Engine's key appeared nowhere in cookies, storage, addresses or frames. The dashboard shows every Owner as one
identity, "Deployment session token": the Engine cannot tell two Owners apart.

# 5. The look, Arabic and the live parts (#827)

- **The theme.** `gtmworks-theme.yaml` (DESIGN.md's canvas, ink, surface, hairline and graphite) in the Engine's data
  volume at `/opt/data/dashboard-themes/gtmworks.yaml`, made the default by `dashboard.theme: gtmworks` in the Engine's
  config. The first page painted `rgb(250, 250, 250)` (`--background-base: #fafafa`) from the theme's first-paint block,
  with no choice made by the person. The dashboard's own display fonts stay.
- **Arabic: yes, right to left.** With the dashboard's language set to Arabic (`hermes-locale` in the browser's storage)
  the page is `lang="ar" dir="rtl"` and lays out from the right. Its Arabic is partial: Files, MCP, Channels, Webhooks,
  Pairing and some buttons stay in English, and one button's icon overlaps its English label. The language is the
  browser's choice, not the server's: nothing in gtmworks's language reaches it unless the page is told.
- **The live parts.** Through the gateway at the Company's path, the board's event socket
  (`/api/plugins/kanban/events`) delivered the Card made while it was open, and the chat opened `/api/ws` (6 frames from
  `gateway.ready` on), `/api/events` and `/api/pty`, Hermes's terminal chat in a pseudo-terminal on the Engine.
- **The pinned backend holds.** `PUT /api/config` with `terminal.backend: local` from the Owner's dashboard answered 200
  `{"ok":true}`, and the next terminal command ran as `pn` on host `7c90a3c42dee`, the Company's Work sandbox.

# 6. What the dashboard gives an Owner that gtmworks does not, for Omar

Tried through the gateway as the Owner where marked; the others are read from the routes
(`hermes_cli/web_routers/`). "Gateway" means a path rule can refuse it; a dashboard plugin can hide or replace a page
(`tab.override`) but not remove its API.

| Page | What it lets an Owner do | Who could close it |
| --- | --- | --- |
| Keys (`/env`) | **Read the Engine's own key**: `POST /api/env/reveal` of an Agent profile's `API_SERVER_KEY` answered 200 with the Engine's key (tried). Also every model and platform key of the Engine, and write keys | gateway (`/api/env/reveal`, `PUT /api/env`) |
| Files (`/files`) | Read, write and upload anything in the Engine's data volume: every Agent's memory, sessions and the Company's model sign-ins. `GET /api/files?path=/opt/data` answered 200 with its listing (tried) | gateway (`/api/files`, `/api/fs`) |
| Chat (`/chat`) | Talk to any Agent in Hermes's terminal chat, a pseudo-terminal on the Engine, as the shared deployment identity: no gtmworks Conversation, no gatekeeping, no record of who | gateway (`/api/pty`, `/api/ws`, `/api/events`) |
| Sessions (`/sessions`) | Read every session of every Agent, every Member's Conversations included | gateway, or keep it as the Owner's |
| Plugins (`/plugins`) | Install and enable a plugin: code that runs inside the Engine. `GET /api/dashboard/plugins` answered 200 (tried) | gateway (the install and toggle routes); or pin `plugins` in the Engine's managed config |
| MCP (`/mcp`) | Add MCP servers, so Agents reach new outside systems. `GET /api/mcp/servers` answered 200 (tried) | gateway (`POST/DELETE /api/mcp/…`) |
| Channels (`/channels`) | Connect Telegram, WhatsApp, Slack and others, so Agents talk and publish outside gtmworks with no gtmworks record. `GET /api/messaging/platforms` answered 200 (tried) | gateway (`/api/messaging`) |
| Webhooks (`/webhooks`) | Make inbound webhooks that start Runs | gateway (`/api/webhooks`) |
| Pairing (`/pairing`) | Pair a device or the Hermes desktop app with its own long-lived grant | gateway (`/api/pairing`, `/auth/native/…`) |
| Profiles (`/profiles`) | Make, rename and delete Agents directly; gtmworks's records of its Agents drift | gateway (writes), or a plugin that reports back |
| Config (`/config`) | Change any setting of any Agent. The pinned terminal backend holds (section 5); settings outside the managed file do not, such as the toolsets ADR 0018 keeps off (`browser`, `kanban`, `connections`) | managed config for each setting that must hold; a gateway cannot read a body |
| System | Restart the gateway, **update Hermes** (`POST /api/hermes/update`) away from the install's pin, import a backup (`/api/ops/import`) | gateway (`/api/hermes/update`, `/api/ops`) |
| Cron, Skills, Models, Logs, Analytics, Kanban, Docs | Routines, Skills, model sign-ins, the Engine's logs (which hold message text), usage, the board with no gtmworks identity on a write, Hermes's docs | gateway per page, if wanted |
| "Help improve Hermes?" (every page) | Send usage counters to Nous once a day | managed config, or the theme's CSS hides it |
| A shell on the Engine (`/api/host-terminal`) | Refused here: the socket closed with 1006 (tried) | already closed in this deployment |

# 7. What this means for the Owner's dashboard spec

- **Build the gate into gtmworks's gateway**, the way this probe's gate works: every request and every upgrade under
  `/engine/<company>/` is asked about, the answer is gtmworks's own `is_company_owner` for that person, and anything else
  is the missing page. The gateway adds the Engine's key and drops gtmworks's cookie; the browser never holds the key.
- **Serve `/assets/` too**, to the Owner of the page that asks for it, or the dashboard's inner pages do not load.
- **Close open sockets when a Role changes.** nginx cannot: the gate is asked once per upgrade. Either the dashboard is
  carried by gtmworks's own server, which closes a person's sockets when their Role changes, or sockets are given a short
  life. Until then a person who loses the Role keeps the pages they have open, chat and terminal included.
- **Decide the page list with Omar** (section 6). At least the Engine's key (`/api/env/reveal`) and updating Hermes
  (`/api/hermes/update`) should be refused at the gateway; the rest is Omar's list.
- **Keep the settings that must hold in the managed config**, as the terminal backend is; a write from the dashboard is
  kept but has no effect there. Anything else an Owner can change.
- **Ship the theme with the install** (`dashboard-themes/gtmworks.yaml` and `dashboard.theme`), and set the dashboard's
  language from the person's gtmworks language; its Arabic is partial.
- **Expect one identity.** Every Owner is "Deployment session token" to the Engine, so what an Owner does there is in
  no log with their name unless gtmworks's gateway writes it.
- **Do not use the OIDC way** unless gtmworks becomes an OpenID provider over https that the Engine can reach, which
  ADR 0018 rules out.

# 8. The run

```
__OUTPUT__
```
