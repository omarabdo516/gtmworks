# gtmworks roadmap

Where gtmworks is going, one line per feature, grouped by area. The short list is in the [README](README.md#roadmap).

- ✅ done: merged and released, so a running install has it (an install that follows releases updates within minutes)
- 🟡 in progress: being built, partly built, or merged and waiting for its release
- ⚪ planned: decided or an idea, nothing built yet

Evidence in brackets: `#n` is an issue or pull request here, `ADR n` is in `docs/adr/`, and `decision n` or `rs 0082` is one of the owner's decision records, kept outside this repo. A pull request that builds a line marks it here in the same pull request (`AGENTS.md`).
## Next

The order Omar set on 2026-11-21 (rs 0082, rounds 3 and 4):

1. **RS Academy goes live on gtmworks.** One Company with two business lines kept apart inside Company knowledge for now.
   - Knowledge: deep, read from every source, one section per line [rs 0082 Q3, Q12].
   - First Agents: Lead, customer problems first, then training manager, leads and follow-up, content and ads as two Agents [rs 0082 round 2].
   - Connections: the platform's MCP server already works as a remote server (`rspaac.com/api/mcp`); Google Drive (one folder), GitHub and Odoo come next [rs 0082 Q11, Q13, Q14].
2. **A key for a command MCP server.** An Owner gives a command server running in the work sandbox its key or token file, which opens Google Drive (one folder) and Odoo through ready-made servers [rs 0082 Q33].
3. **Triggers and efficiency.** The event door, the routine check that runs before the model wakes, and a cheaper model for routine work [rs 0082 Q16, Q20, Q21].
4. **The rest**, in the order the team's real work asks for it: publishing, presenter videos, ad campaigns, results, the monthly plan.
5. **Building from gtmworks, last.** After everything is stable [rs 0082 Q18, Q19].

Blocked now: no release since 2026-11-21 07:28 UTC (#572), so lines marked "waiting for the release" are merged but not yet on a running install.

In flight now: Open Design (#544, PR #570), the Agent's screen (#196 to #199).

---

## 1. Install and updates

- ✅ **One-line install.** One `curl` line installs a ready, tested release into `~/gtmworks`; nothing is built on the server. [#51, #60, tag v0.1.0, decision 0015]
- ✅ **`gtmworks update` from release to release.** Backs up first, refuses to go older than the data, and rolls back a failed migration. [#52, #60, ADR 0023]
- ✅ **Update ready.** Owners see when a newer gtmworks exists and what it brings, and only versions that have an image. [#442, #444, #468, #481, decision 0051]
- ✅ **Update now.** One click updates the install through a small updater on the host, never from the web app. [#443, #445, ADR 0020 "update now"]
- 🟡 **A failed update leaves no half-made sandbox.** The previous release keeps serving and what the update made is removed. Merged; waiting for the release (#572). [#479, #549]
- ✅ **Every release is tested.** Releases publish the newest commit whose CI passed, and a release is immutable. [#49, #448, decision 0019]
- ✅ **First-run link only for the server's owner.** Setup is protected by an installer link with the code in the URL fragment. [#50, #53, decision 0016]
- ✅ **Works behind an HTTPS proxy.** Links and redirects follow the proxy address. [#40, #43, decision 0014]
- 🟡 **Backup and restore.** A backup holds every Company's database rows, Engine and work folder, and restores into an empty install. Merged; waiting for the release (#572). [#33, #357, #349, #386, #399]
- 🟡 **Fewer keys in the app.** The app and the worker get only the values they read. Merged; waiting for the release (#572). [#446, #539]
- 🟡 **Server sizes measured.** The README states two sizes (with and without video) from the install job's numbers. Merged; waiting for the release (#572). [#400]
- 🟡 **Safer failed updates.** An update that fails before its Engines start leaves the previous release's own Engine files on disk. Merged; waiting for the release (#572). [#554]
- 🟡 **A disk limit for each work sandbox.** Today one Company can fill the install's disk. [#507]

## 2. Team and Agents

- ✅ **Lead runs the team.** The main Agent hands a job to the Agent that does it, offers to make an Agent for recurring work, and opens a new Company's first Conversation. [#434, #441, decision 0050]
- ✅ **Lead makes an Agent from a plain request.** The Owner says what is needed and Lead creates it in the Engine. [#12, #13, #89, #91]
- ✅ **Ready-made roles.** Lead starts from a proven role (ads, ad reviewer, article writer, numbers, coder) and the gallery sits beside its composer. [#14, #102, #104, #189]
- ✅ **One Engine profile per Agent.** An Agent is its own profile with its own memory, Skills and settings, and the main Agent keeps the Company's first profile. [#119, #120, #121, ADR 0016, decision 0035]
- ✅ **Agent settings are the Engine's real settings.** Name, About, How it works, thinking level, model, Skill switches, saved with a bar. [#125, #161, #175, #176, #179, #180, #352]
- ✅ **The main Agent is configurable like any Agent.** [#425, #431]
- 🟡 **Agents propose changes to themselves.** An Agent proposes a change to its model, instructions or settings; the Owner edits, then approves, and the Agents list shows "Proposal waiting". Merged; waiting for the release (#572). [#19, #178, #482, #484]
- 🟡 **Every Agent asks any other Agent (Handover).** In a Conversation or a channel, any Agent hands a job to any other, even one the person cannot see, and the asked Agent may hand on in turn. Merged; waiting for the release (#572). [#475, #476, #477, decision 0057]
- 🟡 **A Member asks for an Agent hidden from them.** The main Agent says so without naming it, and an Owner or Manager opens it. Merged; waiting for the release (#572). [#17, #167, #500]
- ✅ **Per-Member Agent visibility.** The Owner chooses which Agents each Member sees. [#15, #190]
- 🟡 **Agent faces and status.** Faces look, blink and hop, a dot shows state, and the sidebar tile flashes when Lead makes an Agent. Merged; waiting for the release (#572). [#133, #134, #184]
- 🟡 **Full power first.** An Agent gets the Engine's whole power, publishing and spending included when a Member asks; a limit is added only after a real problem. Agent levels were removed. Merged; waiting for the release (#572). [#391, ADR 0020 "full power", decision 0053]
- 🟡 **Standing permissions with Revoke.** "Always allow" answers are listed with who and when, and an Owner or Manager can revoke one. Merged; waiting for the release (#572). [#163, #164, #165, #166, #499]
- ✅ **The Agent's details show its files and its screen.** [#21, #194, #195, #208]
- 🟡 **Stop ends the whole Handover chain.** Stop in a chat, or on a channel message's Run, also stops every Handover started from it down the whole chain, each shown as stopped, and nothing more starts after it. Merged; waiting for the release (#572). [#474, #478, PR #571]
- 🟡 **Add a file for the Agent to work from.** The files tab is disabled today; needs a proof on the pinned Engine first. [#196]
- 🟡 **The Agent's screen: watch and wake.** Watch the Agent's browser in a large view, and "Wake it". [#197]
- 🟡 **The Agent's screen: take control.** Take control for one session, then "Done". [#198]
- 🟡 **A handed step opens the screen.** "Open the screen" and "Done it" in the view. [#199]
- 🟡 **Pause and resume an Agent.** The Settings page has the button, but the pinned Engine cannot pause one Agent, so the issue is closed while the control stays "Soon" in the test (unclear). [#177, commit 4748aca4]
- ⚪ **Business line inside a Company.** A line with its own voice, audience and look inside one Company, only if real mixing shows the need; until then lines are separated in Company knowledge. [rs 0082 Q3, decision of 2026-11-21]
- ⚪ **Repo manager Agent.** A specialist Agent that follows each repo; deferred until the other Agents prove efficient and stable. [rs 0082 Q14, Q18]

## 3. Conversations and channels

- ✅ **Conversations with an Agent.** One person's private exchange with one Agent; any Member except a Viewer may start one. [#6, #8, #25, #39]
- ✅ **Cards inside replies.** Draft card, review card, question card, "Handed to you" card, and "Used N tools" under a reply. [#136, #137, #138, #139, #140, #141]
- ✅ **Permission requests in the chat.** "Allow once / Always allow / Don't allow", also waiting in "Waiting on you" and in channels. [#163, #165, #321]
- ✅ **Composer.** "+" menu, `@` and `/` suggestions, image attach, commands such as /campaign, /report, /review, /article. [#153, #154, #155, #156, #158, #159]
- ✅ **Dictation in Egyptian Arabic.** The Owner picks a speech-to-text provider; Deepgram Nova-3 first. [#160, #430, #435]
- ✅ **An Agent's voice settings.** Speaking language, voice, speed and "Listen". [#162]
- ✅ **Channels.** A general channel, team channels with chosen Members and Agents, unread counts, and an Agent answers only when called by name. [#23, #24, #109, #118, #152]
- ✅ **Channel replies carry cards and steps; mentions reach the right person.** [#148, #149, #150, #151, #200]
- ✅ **Team-work rules.** The author comes from the session, a busy Agent queues the next Member's message, a message to a person does not wake the Agent, and a Member keeps a private note. [#65, ADR 0015, FEATURES.md rules a to g]
- 🟡 **Errors that say why.** No model connected, a model error that cannot pass, a missing image, and a stopped Engine that waits up to ten minutes. Merged; waiting for the release (#572). [#368, #413, #422, #428, #457]
- 🟡 **Good morning.** The main Agent opens a new chat with a card of what waits and what ran overnight, switched on and timed in its settings. Merged; waiting for the release (#572). [#182, #183, #506, #524]
- ✅ **Empty chats help.** Lead's four suggestions, and "Try starting with this sentence" for a new Agent. [#170, #171, #292]
- ✅ **A chat starts a Card, and a Card has its Chat.** [#144, #145, #146, #147]
- 🟡 **Reliable queued turns.** A retried turn whose stored image is gone still holds up its Conversation; a stopped Engine still fails the start of queued turns and Handovers; a job command's Agent cannot ask in the chat. [#465, #514, #470, #530]
- ⚪ **Talk to an Agent live by voice.** A full-duplex voice mode while the Agent works in the background, separate from dictation; candidate `gpt-live-1`. [decision 0052]
- ⚪ **Hermes Group Chat under channels.** The spike shows it is possible only as "Hermes room = engine"; not pursued now (hard caps clash with decision 0057). [decision 0058 (idea)]

## 4. Work: board, cards, projects, routines

- 🟡 **The board.** Six columns over the stages, drag with undo, Shift plus arrows to reorder, motion as designed. Merged; waiting for the release (#572). [#34, #131, #168, #174, ADR 0013]
- ✅ **The Card sheet.** A Card opens over the board with its Chat and Log. [#116]
- ✅ **Board, calendar and list views of Cards.** [#34, `work.tsx` has `work/calendar` and `work/list`]
- ✅ **Versions and Approvals.** Editing makes a new Version, an approval applies to one exact Version, and an Agent never approves. [#16, #137, GLOSSARY.md Version, Approval]
- ✅ **"Waiting on you".** One list for approvals, questions, permissions, requests and mentions. [#16, #165, #200]
- ✅ **Add an idea.** The Ideas column takes a new Card, once even if pressed twice. [#188, #452]
- ✅ **Alone or with a team.** First run asks one question; "Alone" hides the team parts until the first Member joins. [#9, #10, #186]
- ✅ **Notes and mentions in the log.** Notes call Members and Agents, editable for five minutes. [#22, #114]
- ✅ **Activity log.** One log for the Company with paging and filters. [#11]
- 🟡 **Routines.** Each Agent's recurring work in its details and in Settings, added with one sentence, run now, paused, with the last result. Merged; waiting for the release (#572). [#31, #205, #488, #517]
- ✅ **Approval steps in Settings, Work.** [`ApprovalSettings` in `approvals.tsx`, decision 0013]
- 🟡 **Projects.** A project has a name, goal and status and holds Cards; the glossary also gives it an Offering, a Key date, Ad campaigns and Results, which are not built. [`projects.tsx`, `work_projects` table, GLOSSARY.md Project]
- 🟡 **A Card in review whose Manager cannot see its Agent.** It can wait on a person who cannot open it. [#513]
- 🟡 **Board polish.** A drop leaves the board where the Card was let go instead of scrolling back to its old place (#556 ✅); a Card hidden by its Agent stays hidden everywhere. [#228, #367]
- ⚪ **A board like the Hermes Kanban board.** Cards assigned to an Agent or a person ("Assign to me"), Agents claim and move their Cards themselves, and a Card's details cut to the minimum; to be grilled first. [decision 0060 (idea), rs 0082 Q38]
- ⚪ **Search.** The sidebar's Search says "not available yet". [`lib/navigation.ts` placeholders]
- ⚪ **Monthly plan.** A month of Posts with date, pillar, offering, segment and hook, built from the approved Diagnosis and shown as the calendar. [GLOSSARY.md Monthly plan, Post, Pillar; no code in app/ or lib/]

## 5. Knowledge, skills and lessons

- ✅ **gtmworks stores nothing Hermes already keeps.** Skills, knowledge, rules, run steps and usage live in the Engine and are read from it. [#340, #343, #344, #345, #346, #347, ADR 0017, ADR 0022]
- ✅ **Company knowledge.** What every Agent's Run is given, kept as the shared Skill `company-knowledge`. [#27, #111, #344]
- ✅ **The Company's shared Skills folder.** One folder every Agent reads; approved lessons land there. [#122, #222]
- ✅ **Skills per Agent.** Switch a Skill on or off, write one into an Agent's profile, "See before and after". [#180, #181, #343]
- ✅ **Lessons.** An Agent saves a lasting rule it is told; a Contributor's rule is suggested to the team and waits for an Owner or Manager. [#18, #25, #106, #110]
- 🟡 **Learning mode, "Forget this", "Restore the previous version".** Merged; waiting for the release (#572). [#28, #436]
- 🟡 **Agent memory.** The Memory tab: read, edit in place, search, forget with undo, reset; a change the Engine holds always gets its log row. Merged; waiting for the release (#572). [#191, #192, #193, #350, #353, #370]
- ✅ **Usage.** Token use read from Hermes. [#32, #347]
- 🟡 **Settings writes that cannot go stale.** A conditional write for an Agent's settings, and removing one standing permission atomically. [#486, #503]
- ⚪ **Offerings and Segments as lists.** A Company's own list of what it sells and to whom, each Offering linked to its Odoo products; today a Card carries "offering" and "segment" as plain text. [GLOSSARY.md Offering, Segment; `work-actions.ts` fields]
- ⚪ **Key dates.** Dates the content is built around, written by the team or read from Odoo events. [GLOSSARY.md Key date; no code]
- ⚪ **Stronger memory, like Omar's vault and Hindsight.** A memory provider per Company on its Engine, one bank shared by its Agents. [decision 0056]
- ⚪ **Deep Company knowledge for RS Academy.** Read from every source (the Odoo, platform and sales-agent repos and vault notes), not a summary of one folder. [rs 0082 Q12]

## 6. Connections and tools

- ✅ **Connect apps.** A sheet from the sidebar, the account menu and the composer; the Engine's own catalogue of apps, each turned on or off per Agent. [#30, #112, #201, #202, #320]
- ✅ **The "Connect X" card.** An Agent asks for an app it needs, with "Later" and "Connect". [#203, #204]
- ✅ **Any remote MCP server.** By address, with no sign-in, a token or OAuth, and every app comes with all its tools. [#458, #461, ADR 0021]
- 🟡 **Command MCP servers run in the work sandbox.** Merged; waiting for the release (#572). [#550, #459 (the issue stays open for Open Design), ADR 0024]
- ✅ **Model connection per Company.** A ChatGPT or Claude subscription signed in once on the Company's own Engine, or an API key written to every profile. [#3, #123, #124, #251, #384, #438]
- 🟡 **A work sandbox per Company.** Terminal, files, code, fonts and a Screen, reaching the internet only, with the Library showing its work folder. Merged; waiting for the release (#572). [#389, #390 to #400, ADR 0018, ADR 0020 "work sandbox image"]
- ✅ **Each Company runs on its own Engine.** `gtmworks company add` makes one, with a first-Owner link. [#378, #379 to #387]
- ⚪ **A key for a command MCP server.** A command server in the work sandbox gets its key or token file from the Owner, never from an Agent; it is what Google Drive and Odoo need. [rs 0082 Q33]
- 🟡 **The app list follows the person.** The browser's copy of a Company's apps is the signed-in person's alone, and is dropped when someone else signs in without the tab reloading. Merged; waiting for the release (#572). [#552, #599]
- ⚪ **Google Drive, one folder only.** Agents read, write and organise inside one folder, "RS Academy", through a separate Google account the Owner shares that folder with (a Google sign-in cannot be limited to one folder), on a ready-made Drive MCP server in the sandbox. [rs 0082 Q11, Q13, Q31]
- ⚪ **GitHub, read and issues.** GitHub's own remote MCP server with fine-grained tokens on the chosen repos: Agents open issues labelled `from-agent`, Lead reads pull requests, checks and issues. Works with today's remote MCP support. [rs 0082 Q14]
- ⚪ **Odoo.** A ready-made Odoo MCP server, read-only first with its own Odoo user; later the Agents read the whole ERP, find problems and propose fixes. gtmworks is not a CRM and leaves leads in Odoo. [rs 0082 Q5, Q32]
- ⚪ **Several model accounts with failover.** Add more than one Claude or ChatGPT account and an API key; the Engine already switches, gtmworks needs the screen to add and order them. [decision 0055]
- ⚪ **T3 Code as a connection.** Route 1 (any MCP server) is built; a ready-made T3 entry is open and less likely now that Omar builds on Claude Code cloud sessions. [decision 0054, rs 0082 Q19]
- ⚪ **Messenger conversations as a source.** The customer problems Agent reads them. [rs 0082 Q15]

## 7. Content, design and publishing

- ✅ **Hand a step to a person.** What no Agent may do (publish where there is no API) is prepared by the Agent and marked "Done it" by a person. [#139, #140, GLOSSARY.md "Handed to you"]
- 🟡 **The Library.** Files each Agent made in the work sandbox, with a read-only preview and download. Merged; waiting for the release (#572). [#194, #195, #395]
- ✅ **Ready-made roles for content.** An article writer (leaves drafts in WordPress), an ad reviewer, a numbers reader. [#14, `ready-made.en.json`]
- ✅ **A Card carries its publishing date, caption fields and design Versions.** [#116, `work-actions.ts` fields title, offering, segment, hook, channel, format]
- ✅ **Buffer and Hootsuite as connected apps.** An Agent can schedule through them today. [#458, `lib/app-catalogue.mjs`]
- 🟡 **Designs made by Agents with Open Design.** The Open Design daemon runs in the sandbox and answers through the Company's own Engine, subscription sign-in included. [#544, PR #570, decision 0059, decision 0054]
- ⚪ **Publishing to Meta, Instagram and TikTok.** gtmworks publishes at the approved time; no key enters a sandbox. No ticket yet. [decision 0045, decision 0046, GLOSSARY.md Post]
- ⚪ **Presenter videos made from a Card.** The ad presenters (Mariam, Mansour) move from Omar's Hermes into gtmworks; the sandbox already offers the machine for rendering. [decision 0045, ADR 0018]
- ⚪ **Company Voice.** Tone, dialect, examples, calls to action, hashtags; every change is a new version. [GLOSSARY.md Voice; no code]
- ⚪ **Content rules and Brand check.** Rules a post must follow, checked after the caption is written and on every edit. [GLOSSARY.md Content rule, Brand check; no code]
- ⚪ **Content pillars.** Kinds of content with a target share of posts. [GLOSSARY.md Pillar; no code]
- ⚪ **Publishing page.** The sidebar's Publishing and Campaigns entries are empty today. [`lib/navigation.ts`]

## 8. Ads and campaigns

- ✅ **Meta Ads and TikTok Ads as apps.** Connect them by sign-in and every tool comes with them. [#458, `lib/app-catalogue.mjs`]
- ✅ **A ready-made ads Agent.** Plans Facebook and Instagram campaigns, watches cost per lead, proposes pausing waste. [#14, `ready-made.en.json` line.meta]
- ✅ **Hand a job with /campaign.** [#159]
- ⚪ **Google Ads as a ready-made connection.** Not in the catalogue today. [`lib/app-catalogue.mjs`, rs 0082 integrations]
- ⚪ **Ad campaigns in gtmworks.** A campaign as Meta or Google define it, with its own budget, linked to a Project; gtmworks has none of its own. [GLOSSARY.md Ad campaign; the Campaigns page is empty]
- ⚪ **Content and ads as two separate Agents that work together.** RS Academy's Team v1. [rs 0082 round 2]

## 9. Results and numbers

- ✅ **The Numbers page.** Four figures (spend, leads, cost per lead, revenue), a period switch, a leads chart and a channel table, with "waiting for approval" and "what the agents did this week". [#35, #134, #172]
- 🟡 **Numbers from connected apps.** The page reads through `connectedApps()`, which returns an empty list today, so no live figure shows; the issue is closed but the source is a stub (unclear). [#35, `lib/numbers.mjs`]
- ⚪ **Results as records.** A number for a period, read from a connection or typed in by the team, such as leads by source and sales per offering. [GLOSSARY.md Result]
- ⚪ **Monthly Diagnosis.** The AI's read of last month's results, approved inside the Company before the monthly plan. [GLOSSARY.md Diagnosis; no code]
- ⚪ **Results for a Project.** Sales and leads per project goal. [GLOSSARY.md Project]
- ⚪ **Sales, Performance and Strategy pages.** Sidebar entries that open empty. [`lib/navigation.ts`]

## 10. People, roles and access

- ✅ **Roles.** Owner, Manager, Contributor, Viewer, and no agency layer. [#7, ADR 0012, GLOSSARY.md Role]
- ✅ **Sign in with email and password.** [#41]
- ✅ **Invite links without email.** One use, seven days, with the role and the Agents the person will see. [#185, #187, ADR 0019]
- ✅ **Several Companies in one install.** Each with its own data, Engine and work sandbox; a role in one grants nothing in another; proven by database tests. [#378, #382, #383, #337, ADR 0004, ADR 0018]
- ✅ **Every route checks the role.** A route-to-permission table, re-checked on each request. [FEATURES.md rule b]
- ✅ **Team table and Team dialog.** Invite a Member inline, "Invite sent" rows. [#185, #187, #207]
- 🟡 **Separate Grants.** Publishing, money figures and customer data per Member exist as columns; how far the UI uses them is unclear. [foundation migration `members`, GLOSSARY.md Grant]

## 11. Triggers and efficiency

- 🟡 **Routines on a schedule.** An Agent works while the person is away. Merged; waiting for the release (#572). [#31, #205]
- 🟡 **The morning message.** A schedule that wakes the model directly, only for this one. Merged; waiting for the release (#572). [#182, #183, rs 0082 Q20]
- ✅ **Usage from Hermes.** What each Agent spent. [#32, #347]
- 🟡 **Routine results kept as they end.** A very frequent Routine's night is no longer cut by the Engine's list of its newest 100 runs: each result is kept as its run ends and the morning reads what was kept. Merged; waiting for the release (#572). [#535]
- 🟡 **Routine writes in order.** Ordering guarantees for a Routine's writes; "making another Agent main stops an interval schedule". [#555, #527, #532]
- ⚪ **Event door.** A webhook signal from the platform (payment, report) or GitHub reaches the right Agent, built on Hermes webhook subscriptions. [rs 0082 Q20, Q21]
- ⚪ **Routine check before the model wakes.** A cheap script runs first (Hermes cron `script` gate with `wakeAgent=false`) for sources that cannot send events, such as Odoo and Messenger history. [rs 0082 Q20, Q21]
- ⚪ **A cheaper model for routine work.** Routine runs use a cheaper model than Omar's conversations. [rs 0082 Q20]

## 12. Building from gtmworks

Last on the roadmap, after everything is stable [rs 0082 Q19].

- 🟡 **A work sandbox with terminal, files and code.** What a coding Agent needs, in the Company's own sandbox. Merged; waiting for the release (#572). [#389, ADR 0018]
- ✅ **A ready-made "coder" role.** Builds a written change request, runs tests, opens a pull request and stops. [`ready-made.en.json` line.coder]
- ⚪ **Code Cards and the coding Agent.** Software work on the same board, read from its pull request. Closed as not planned for v1 and reversible. [#36, decision 0043]
- ⚪ **The coding process inside gtmworks.** Grill, spec, tickets, build, verify, run from gtmworks the way Omar runs it with Hermes. [rs 0082 Q14, Q19]
- ⚪ **Repo manager Agent.** See section 2. [rs 0082 Q18]

## 13. Quality and how gtmworks is built

- ✅ **Fast, trustworthy checks.** A draft runs the fast checks only, a ready PR runs the full suites it needs, 7-day quarantine for flaky tests, install areas of their own. [#255, #332, #333 to #338, #402 to #410, decision 0049]
- ✅ **Compared screens on main.** The visual lane runs on main only and opens one issue on a failure. [#257, #291]
- 🟡 **The approved design is matched screen by screen.** Merged; waiting for the release (#572). [#4, #8, FEATURES.md, #127 to #135]
- 🟡 **Cloud Claude Code sessions.** One command brings up the full local app and walks it as a person; Matt's skills are vendored. Merged; waiting for the release (#572). [#473, #485, #487]
- 🟡 **Flaky tests and CI.** About two dozen open issues (flaky journeys, dockerd in cloud sessions, a missing visual baseline, a hydration mismatch). [#497, #501, #510, #520, #521, #522, #526, #528, #529, #534, #537, #540, #542, #546, #547, #548, #553, #557, #559, #560, #561, #564, #566, #568]
- 🟡 **The parent spec of the team workspace.** Spec #1 is still open with its remaining tickets. [#1]

---

## Not on the roadmap (decided against or out of scope)

- gtmworks is not a CRM; leads stay in Odoo. [rs 0082]
- The assistant a customer talks to lives in the platform, never in gtmworks. [rs 0082 Q8]
- No second task engine: Hermes owns agent work. [PRODUCT.md, ADR 0017]
- An outside-agent API and "connect a Hermes you already have" were removed. [#341, #342]
