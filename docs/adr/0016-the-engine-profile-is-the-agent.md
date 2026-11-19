---
status: accepted
date: 2026-11-16
---

# The Engine profile is the Agent, and settings are the Engine's own

Omar's decision of 2026-11-16, ticket #119: «هناخد من الجاهز في هيرمز علطول وطرقة اعداداته نحطه في طريقة اعداداتنا». We take what Hermes already has as it is, and its way of setting things up becomes ours. This supersedes [ADR 0014](0014-one-hermes-profile-per-company.md) where they conflict and returns to the rule of [ADR 0011](0011-agents-are-engine-profiles-made-on-the-management-listener.md) that one Agent is one Engine profile. Isolation between Companies stays as ADR 0014 built it. Everything in ADR 0008 to 0013 and ADR 0015 that this record does not name still holds.

## Context

ADR 0014 put every Agent of a Company on the Company's one profile, so that the team would share memory, Skills and sign-in. Two costs followed. An Agent could not have its own model, soul, memory, Skills or Routines, because the Engine keeps all of them per profile. And gtmworks had to carry an Agent's own instructions itself and send them with every Run.

The pinned Engine (Hermes v0.23.0) already sets all of these per profile. A profile's memories, sessions, Skills and scheduled jobs live in its own home (`hermes_cli/profiles.py` line 40, `_PROFILE_DIRS`). Its management listener makes and removes a profile and sets its soul and model (`hermes_cli/web_routers/profiles.py` lines 814, 984, 1005, 1020 and 1056). It serves each profile's settings and writes them back (`hermes_cli/web_routers/config_env.py` lines 81, 95, 100 and 122). Building a second settings model in gtmworks would copy what the Engine has and drift from it. Every path in this record is in the pinned Engine's source at tag `v0.23.0`.

## Decision

### The profile is the Agent

Each Agent of a Company on the bundled Engine is one Engine profile. Its model, provider and model options, apps and toolsets, soul and personality, memory, Skills and Routines are set per Agent, through the Engine's own config and management listener. Sub-agents are set the same way once the `delegation` toolset is on for that Agent (see Open decisions). The reason is that the Engine already scopes every one of these to a profile, so an Agent that is a profile gets them with no gtmworks copy. This reverses ADR 0014's "Agents on the Company profile".

An Agent's own instructions become its profile's soul (`PUT /api/profiles/<name>/soul`) instead of text gtmworks sends with each Run. Member notes (ADR 0015) still go with each Run as its `instructions`, because they depend on who writes. Rules (#18) went with each Run too until #345: the team's rules are now written into a section of the Agent's profile `SOUL.md` that gtmworks owns (`lib/agent-rules.mjs`), and no Run carries them.

### Names

- The Company profile `co-<company id>` stays as the profile of the Agent that was the Company's main Agent when the Company moved to a profile per Agent. Nothing in it is moved, copied or renamed. The reason is that its memory, sessions and sign-in belong to that Agent's past Conversations, and the Engine renames a profile only by moving its whole home (`hermes_cli/profiles.py` line 2254, `rename_profile`).
- Every other Agent's profile is `ag-<agent id>`. This supersedes ADR 0011's rule that a profile is named for its Agent, because an Agent's name may change and the profile's may not. An Agent that already runs on `co-<company id>` and is not the main Agent gets its own `ag-` profile and moves to it under ADR 0014's move rules. Its earlier Hermes context stays in `co-<company id>`, and its gtmworks record moves with it.
- Each Company also has one shared space, `cs-<company id>`. It holds what the Company's Agents share, such as the shared Skills folder below. It is made with no Run API key, so the Engine refuses every Run on it (`gateway/platforms/api_server.py` lines 1389 to 1434). The reason for a profile and not a bare folder is that the management listener writes a Skill into a profile (`hermes_cli/web_routers/skills.py` line 457) while that profile's `skills.create_dir` is empty.

A profile of any of the three kinds serves one Company only.

### Settings are the Engine's

Settings shows the Engine's real settings and writes a value back through the Engine (`PUT /api/config?profile=`). Each setting's name, type and choices come from `GET /api/config/schema?profile=`, and its default from `GET /api/config/defaults` (`hermes_cli/web_routers/config_env.py` lines 95 and 100). No setting is invented. The reason is that a setting gtmworks invents has nothing in the Engine to apply it.

- The Engine has no Company level. A Company-wide setting is the same value written to each of the Company's Agent profiles.
- A setting the Engine holds once for the whole install is shown as install-wide.
- A setting that a rule of this record or of ADR 0014 owns is shown and never written from Settings: the toolsets of an Agent level (`agent.disabled_toolsets`, `platform_toolsets.api_server`), `skills.external_dirs`, `skills.create_dir` and the profile's Run API key. The reason is that a write there would undo an Agent level or the Company's shared Skills.
- The sub-agent settings on the list (`delegation.model`, `delegation.provider`, `delegation.max_concurrent_children`, `delegation.reasoning_effort`, `delegation.max_spawn_depth`) are written from Settings by the Owner, for one Agent whose sub-agents the Owner turned on (#29). The `delegation` toolset itself stays policy-owned: the tool policy (`lib/agent-levels.mjs`, `public.engine_tool_policy()`) offers it only for an Agent whose Owner turned sub-agents on, and its children inherit the profile's disabled list, so terminal, files and code execution stay off for them (`tools/delegate_tool_toolsets.py` lines 14-22 and 107-115).

### What the team shares

- The team talks to the same Agent, so it shares that Agent's memory.
- Company knowledge (#27) goes with every Agent's Run, as it does today.
- One shared Skills folder per Company, the Skills of `cs-<company id>`, is read by every Agent profile of that Company through `skills.external_dirs` (`hermes_cli/config_defaults.py` line 1434).
- A lesson approved for the team (#25) lands in that shared folder.

The reason is that the team keeps what ADR 0014 gave it, one memory per Agent it talks to and one set of Skills per Company, while each Agent gets its own settings. The Engine does not stop an Agent from changing a Skill in that folder (see What the pinned Engine cannot do). The ticket that builds the shared folder decides how it is kept from an Agent's own edits.

### Sign-in

- **One Company on the install.** A subscription is signed in once on the root profile. The Engine gives it to every profile that has no sign-in of its own for that provider (`hermes_cli/auth.py` lines 813 to 830 and 934 to 958). ADR 0014's rule that fails closed while `default` holds a sign-in is lifted on such an install, and a sign-in on the root profile counts as the Company's, for Settings and for the move of an existing install. The reason is that with one Company there is nobody to share the sign-in with by mistake. When a second Company is made on the install, the lift ends and ADR 0014's rule applies again.
- **An API key** is written to every Agent profile of its Company. A profile the Engine serves reads a key from its own `.env` and never from another profile's (`agent/secret_scope.py` lines 230 to 247, `get_secret`). The one exception is the administrator-managed `.env`, which every profile reads (lines 425 to 434).
- **Several Companies on the install.** ADR 0014's rule stays. A Company uses its own key. A subscription signed in on one Agent profile reaches that Agent only, so a Company that uses its own subscription signs in on each of its Agent profiles. The README tells the install owner that a subscription on the root profile is shared by every Company.
- Claude stays the install's command (`hermes auth add anthropic`), because the pinned Engine refuses to start Claude's sign-in from its management listener (ADR 0014).

### What stays from ADR 0014

Each rule of ADR 0014 is kept or superseded as this list says.

- **A profile per Company.** Kept for `co-<company id>`, which is now the main Agent's profile. The same steps of `provideProfile` (soul, Run API key, tools written and read back, a half-made profile under the reserved name finished, nothing cloned) also make every `ag-` profile.
- **Attaching.** Kept.
- **A Company profile serves one Company.** Kept, and it now covers every `co-`, `ag-` and `cs-` profile.
- **Runs are reserved before Hermes is called.** Kept as written, the reservation, the abandon and the move rules included.
- **Tool policy and pending changes.** Kept, per Agent profile. No Run starts on a profile whose tools are pending.
- **Agents on the Company profile.** Superseded by "The profile is the Agent" and "Names" above. Each Agent has its own Connection row naming its own profile. The driver's `createAgent` stays for a pasted Hermes only, because it writes no tools. An Agent's instructions become its soul and are no longer sent with each Run.
- **Agent levels.** Kept. The level stays per Company (`companies.agent_level`), is enforced by the profile's tools and is read back before a Run. Because the Engine has no Company level, the level's tools are written to each of the Company's Agent profiles, and a Run starts only on a profile whose read-back matches.
- **Tool health.** Kept, for every Agent profile. A profile the Engine no longer serves is forgotten and made again, empty.
- **Model sign-in.** Superseded where "Sign-in" above differs. The sign-in no longer lives in the Company's profile alone. Kept: every step is checked on the server, a member sees the state and has no button, and the driver passes on states, the code and the link only, never a credential.
- **Existing installs.** Kept. On an install with one Company, a sign-in on the root profile counts as the Company's for the move too.
- **Consequences of ADR 0014.** Kept, except the fail-closed rule and the README warning about `default`, which now hold only on an install with several Companies. Memory on `default` stays there. A model on `default` set with an API key is not read by other profiles. A new Company's Agents answer only once it has a model. `install.sh backup` includes the `hermes` volume since #349, so every Agent profile and the shared space come back with a restore; an archive made before that leaves them to be made again empty. Skills and memory stay writable by an Agent in its own profile at every level. The previous app version's `provide_bundled_hermes` stays in place. The install job's proofs of isolation between Companies and its scan for gtmworks's secrets stay.
- **No credential stored, logged or returned by gtmworks.** Kept.

## What the pinned Engine cannot do

Each gap below is in the pinned Engine's source at tag `v0.23.0`.

- **No Company level.** A profile is the only scope. Its memories, sessions, Skills and scheduled jobs live in its own home (`hermes_cli/profiles.py` line 40), and every Run route is mirrored under `/p/{profile}` and nothing wider (`gateway/platforms/api_server.py` lines 3971 to 3978). A named profile with no Run API key of its own refuses every Run (lines 1389 to 1434), so a new Agent profile needs its own key before its first Run.
- **A subscription sign-in is per profile or install-wide, never per Company.** A profile with no sign-in of its own for a provider reads the root profile's, and no other profile's (`hermes_cli/auth.py` lines 813 to 830, `_load_provider_state_with_source` and `_load_provider_state`, and lines 934 to 958, `read_credential_pool`). Every profile also reads Claude Code's own login file unless its config sets `auth.adopt_external_logins: false` (`agent/anthropic_credentials.py` lines 345 to 351).
- **An app's sign-in is per profile.** The Engine keeps an app's sign-in in the profile's own `mcp-tokens` folder, with no fallback to the root profile (`tools/mcp_oauth.py` lines 229 to 233, `_get_token_dir`). An app an Owner connects for the whole Company is signed in once per Agent profile.
- **The settings schema has no limits.** Each field has a type, a description, a category and, for some, choices, and nothing more (`hermes_cli/web_server_config.py` lines 241 to 260, `_build_schema_from_config`). A minimum, a maximum or a length that gtmworks shows must come from the Engine's own refusal of a value.
- **No route deletes a Skill.** The management listener lists, locks, turns on and off, creates and edits Skills (`hermes_cli/web_routers/skills.py` lines 343, 395, 418, 457 and 472). Its uninstall route (line 106) removes only a Skill installed from the hub (`tools/skills_hub_install.py` lines 205 to 211). `DELETE /api/learning/node` archives a Skill, which can be restored (`hermes_cli/web_routers/status.py` lines 780 to 788). Only an Agent's own `skill_manage` tool deletes one outright (`tools/skill_manager_tool.py` line 577, `_delete_skill`).
- **An external Skills folder is not read-only to an Agent.** The Engine treats `skills.external_dirs` as read-only only for its own background upkeep, and an Agent's tool calls may still edit a Skill there (`agent/skill_utils.py` lines 715 to 718). So any Agent of a Company can change the Company's shared Skills unless gtmworks prevents it.

## Open decisions

These two are Omar's, and the third is decided below. Until he decides, each safe default holds.

- Decision for Omar: when an Owner removes an Agent, is its Engine profile (memory, Skills, sessions) deleted? Safe default: the profile is kept. The Engine can delete it (`hermes_cli/profiles.py` lines 1694 to 1795, `DELETE /api/profiles/{name}`), and nothing brings a deleted profile back.
- Decision for Omar: on an install with several Companies, may one Company's Owner connect or disconnect the install-wide subscription from Settings? Safe default: no, it stays the install's command.
- Sub-agents need the Engine's `delegation` toolset (`toolsets.py` line 153, settings in `hermes_cli/config_defaults.py` lines 1313 to 1380), which ADR 0014 kept off at every level. Decided (Omar, 2026-11-18, #29): sub-agents are off for every Agent until its Owner turns them on, one Agent at a time; the setting is kept per Agent, the worker writes the tool policy's sub-agent variant into that Agent's own profile, and terminal, files and code execution stay off for it and its children.

## Consequences

- Each Agent remembers only its own Conversations. A preference one Agent learned does not reach the Company's other Agents.
- Writing a Company-wide setting is one write per Agent profile. A write that stops part way leaves some profiles with the old value, so the worker writes again until every profile reads back the same value.
- Making an Agent makes a profile, as ADR 0011 did, and a profile is never cloned, so a new Agent starts with empty memory.
- The tickets that follow (#120 to #126) and #19, #21, #28, #29, #30, #31 and #35 build on this record.
