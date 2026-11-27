---
status: accepted
date: 2026-11-27
---

# The move onto Hermes ends at a count, and gtmworks keeps no setting Hermes lacks

Omar's decisions of 2026-11-27 (vault decisions 0081, 0082, 0083 and 0084, a grill of nine questions). It carries [ADR 0033](0033-an-interface-and-a-gatekeeper-over-hermes.md) to its end and supersedes its item 3 (Channels) and the bullet of its item 4 that retires gtmworks's settings screens.

Nothing here is built yet. The code, `GLOSSARY.md` and the tests describe today's product until each spec lands; a spec changes the glossary terms it touches in its own pull request.

## Context

- Omar asked for the simplest shape that loses no power: Hermes is the base, and gtmworks is an interface that works on that base, with people, their Roles and their invitations kept apart from it.
- ADR 0033 set the rule (what Agents do and keep lives in the Engine; gtmworks stores only what is about people) and an order of work. It set no line that says the work is finished, and it left Channels and the removals open.
- Read on 2026-11-27, at `1030d559`, by a sub-agent and not checked line by line; each spec counts its own part again before it is built:
  - `supabase/schema.sql` holds 89 tables and 512 functions. By what they hold: people and access 15, the install's own plumbing 5, the old Conversation record 14, the old board 17, Channels 11, features ADR 0033 item 6 removes 9, copies of what the Engine stores 14, unclear 4.
  - `worker/index.mjs` runs 18 loops; about 8 exist only to keep a gtmworks copy in step with the Engine.
  - Sixteen facts are kept both in the database and in the Engine with a sync between them, a Conversation's messages and a Company's model settings among them.
- Read in the pinned Engine (Hermes v0.23.0), the same way:
  - Hermes has no Company. A profile owns its settings, keys and model and inherits nothing from another profile; a new profile can be made as a copy of an existing one (`hermes_cli/profiles.py`, `hermes_cli/web_routers/profiles.py`).
  - The root profile's credential pool is read by a profile that holds no credential of its own for that provider (`hermes_cli/auth.py`, `agent/credential_pool.py`). A comment in `lib/engine/providers.mjs` says a profile never reads another's key. One of the two is wrong, and a probe settles it.
  - Hermes has no switch for one model of a provider, no route that reorders credentials or switches one off, and no way to rename a credential after it is added.
  - The Hermes Desktop App is a shell over the same server: it keeps no record of its own, signs in with the one credential Hermes has, and sends a chat turn over `/api/ws` on the dashboard listener (`apps/desktop/`, `hermes_cli/web_routers/chat_ws.py`).
- Production on 2026-11-26: no Channel message ever.

## Decision

1. **The team's interface is the browser.** gtmworks stands where the Hermes Desktop App stands: its own screens, calling Hermes's own API, with the gatekeeper in front. No installed program is built, and Hermes Desktop is not given to a team: Hermes signs in one owner, so the gatekeeper's server is needed either way. A person who wants an icon installs the site from the browser (`app/manifest.ts`).
2. **Every Hermes setting is drawn in gtmworks and saved straight into Hermes**, through the API Hermes's own dashboard uses, with no copy and no sync (vault decision 0081). The settings screens gtmworks draws stay. The Engine's own dashboard is the install administrator's, for rare technical pages (#915).
3. **The move is done when all four hold:**
   - the database holds only the tables about people and the tables that run the install; any table beyond those is written down with its reason;
   - no fact is kept both in gtmworks and in the Engine with a sync between them;
   - the worker has no loop whose job is to copy from the Engine;
   - the speed targets of vault decision 0071 still hold.
4. **No spec for a new feature is opened until then.** The specs already filed run in their order, and defects are fixed as usual.
5. **Channels leave the product.** The screen goes and its code is deleted. If a team asks for a group chat later, it is built on the Engine in a simpler shape.
6. **A table is dropped only on Omar's yes to the removal spec that names it**, after a full backup that was checked. Each removal has two stages: the code is switched off, then the tables are dropped ([ADR 0023](0023-a-change-the-previous-release-cannot-run-against-is-staged.md)). There are up to four: the old board, the old Conversation record, Channels, and the features ADR 0033 item 6 removes.
7. **gtmworks edits the Engine's own code in three places and no more**, at the Engine's start (`scripts/engine-template.yml`): the work sandbox's file sync (#393), and the two that let a Company hold several ChatGPT accounts and go on with the next when one runs out (#618, #621). Each is offered to Hermes's maintainers, from Omar's account and only after he has read the request. An edit Hermes takes is removed here.
8. **A Company-wide setting is an action, not a record.** For the default model, the Fallback model, the learning mode and the tools level, the Administrator picks a value and gtmworks writes it into every Agent's profile at that moment, keeping nothing. Each Agent's page shows its real value, read from the Engine. A new Agent starts as a copy of the main Agent.
9. **gtmworks invents no setting for Agents' work that Hermes does not have.** One that is really needed is asked of Hermes's maintainers. Two leave now: the switch for each model of a Provider, and renaming a Provider after it is added. The order of accounts and switching one off stay, carried by the edits of item 7.

Technical calls of the grill, put to Omar in its closing summary and confirmed with it:

- A Conversation's Runs stay on the Run API (port 8642), the listener built for a server that calls Hermes, which spec #864 is designed on and Probe A measured. `/api/ws` is built for one person at one program.
- Provider keys go to the root profile's credential pool instead of a copy in each Agent's profile, once a probe proves every profile reads them there. If it fails, keys stay in each profile, with no table of them in gtmworks.
- gtmworks keeps one row for each Agent, holding only what is about people: its Look, who talks to it, who asked for it. The rest is read from the Engine.
- The record behind connecting an app stays: it says which person started the sign-in, which the Engine does not keep.
- The copies of Routine runs and the guard records for revoking a standing permission go; a screen reads the Engine when it needs them.
- The order: spec #864, ticket #846, Channels, the features ADR 0033 item 6 removes, the copies of what the Engine stores, then the drops.

## Considered options

- **Give the team Hermes Desktop, or a copy of it in gtmworks's look.** Rejected: Hermes has one credential and no Roles, so everyone who signs in is its owner; a copy would be a third piece to install and update on every machine, and about 2 400 source files to follow at each Hermes release.
- **Keep a Company's settings in the database and copy them into each profile.** Rejected: it is the sync this decision ends, and about 8 tables and 5 worker loops stay for it.
- **Remove the three edits to reach an unmodified Engine.** Rejected: the several-accounts feature is Omar's own and works. The simpler route is that Hermes carries it.
- **Keep Channels until a team uses them** (ADR 0033 item 3). Rejected: after spec #864 they would be the last place that keeps messages in gtmworks and the last copy of the old Run code, for a feature nobody has used.
- **Send a chat turn the way the Desktop App does**, over `/api/ws`. Rejected for now: that socket serves one interactive client on the listener that holds every power, and the Run API is measured and already carries the design of spec #864.

## Consequences

- A team has no group chat with Agents. People talk in a Card's comments on the board, and each person in their own Conversation.
- No Agent follows the Company by itself. One changed alone stays changed until the Administrator applies the Company's value again, and applying writes over each Agent's own choice; the screen says so before it is confirmed.
- Model menus list every model of the connected Providers, so they are longer. A Provider's name is written once, when it is added.
- Each bump of the Hermes pin checks the three edits again, and the Engine still refuses to start when the text one of them edits has moved.
- Requests to Hermes's maintainers are public and carry Omar's name.
- No new feature reaches the team until the four conditions hold.
