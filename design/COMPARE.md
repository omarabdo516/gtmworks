# Comparing a built screen with the design reference

`design-reference/` (repo root) is the approved prototype for the #284 build, as plain HTML, CSS and JavaScript. Every screen built for #284 must match the same prototype screen at the same width, language and theme. You prove that by attaching a side-by-side capture to the pull request.

## The reference is frozen

- Nobody edits it. Its source of truth is the frozen approval `d893-approved-2026-11-12`, kept outside this repository, and its `SHA256SUMS` ships with it. Everything in that folder is copied into the repo unchanged, dot-folders included.
- `tests/design-reference.test.mjs` recomputes every checksum. It fails when a file changes, goes missing, or is added without a line in `SHA256SUMS`. A change to the reference needs a new approval and a new `SHA256SUMS`, copied in as a whole.
- The product never serves it. Next serves only its routes, and the runtime image copies only the build output. `tests/design-reference.spec.ts` asks the production build for `/design-reference/...` and expects 404.

## Opening the reference by hand

```sh
python3 -m http.server -d design-reference 8800
```

Then open `http://127.0.0.1:8800/index.html?lang=ar` or `http://127.0.0.1:8800/index.html?lang=en`. The `lang` query parameter picks the language (top of `app.js`). Without it, the prototype falls back to the language it saved in `localStorage` under `gtm-lang`, else English. The prototype stores the theme in `localStorage` under `gtm-theme-v2` (`light` or `dark`). It reads that key when it starts (near the end of `app.js`), and its theme switch writes the same key.

## The capture command

```sh
npm run design:compare -- --screen NAME --width PX --lang ar|en --theme light|dark \
  [--built-url URL] [--built-path PATH] [--sign-in EMAIL] [--out FILE.png] [--reference-only]
```

| Flag | Meaning |
| --- | --- |
| `--screen` | A reference screen name from the table in `scripts/design-compare-lib.mjs`. An unknown name prints the valid ones and exits 2. |
| `--width` | Window width in pixels, used for both sides. |
| `--lang` | `ar` or `en`. On the reference this is `?lang=`. On the built app it is the account's saved language, chosen in the settings overlay's Your account as `tests/visual.spec.ts` does. Without `--sign-in`, the sign-in page is opened with `?language=ar` for Arabic and without it for English. |
| `--theme` | `light` or `dark`. On the reference this is `gtm-theme-v2`. On the built app it is the browser colour scheme, which the product follows while the account's theme is `device` (the seeded default). If the account saved another theme, the tool warns. |
| `--built-url` | Where the built app runs. Default `http://127.0.0.1:3000`. |
| `--built-path` | The built page. Default: the screen's path from the table below. A screen with no built equivalent needs this flag or `--reference-only`. |
| `--sign-in` | Signs in through the local Supabase mailbox first, as `tests/sign-in.ts` does. Use the seeded agency owner `omar@example.com`. Without it, a built page that asks for sign-in is captured as the sign-in page, with a message saying so. |
| `--out` | The side-by-side image. Default `test-results/design-compare/NAME-LANG-THEME-WIDTH.png`. |
| `--reference-only` | A debugging aid: captures only the reference side. |

The tool prints the image path. It also writes the two single captures next to the image, as `...-reference.png` and `...-built.png`. Each side has a caption strip naming it (`reference` or `built`) with the width, language and theme. The prototype loads IBM Plex from Google Fonts; offline, the tool warns and the reference is drawn with fallback fonts.

Example, the reference's main screen against the built Conversation with the main Agent:

```sh
npm run design:compare -- --screen home --width 1440 --lang ar --theme dark --sign-in omar@example.com
```

### Screen names

The prototype has no URL routes. Its sidebar switches between four views (`data-view`: `chat`, `board`, `dashboard`, `log`). The account menu (`#btn-me`, then Settings) opens the settings overlay with its sections. The tool reaches each screen by clicking, as a person would. Below 1024 px the sidebar sits behind the menu button, and the tool opens it first.

| Name | Reference screen | Built default |
| --- | --- | --- |
| `home` | The screen the prototype opens on: the Conversation with the main Agent, Lead | `/c/rs-learning/chat` |
| `board` | Sidebar, Marketing board | `/c/rs-learning/work/board` |
| `waiting` | The board scrolled to its "Waiting on you" column | `/c/rs-learning/approvals` |
| `numbers` | Sidebar, Numbers (the dashboard) | `/c/rs-learning/numbers` |
| `log` | Sidebar, Activity log | `/c/rs-learning/log` |
| `card-log` | Board, the first card, its sheet's Log tab: the card's log with the note field (#22, #116) | `/c/rs-learning/work/board?card=1` |
| `card-chat` | Board, the card of Omar's chat with Ads (`c-meta`): its sheet on Chat, with that chat and its composer (#145) | `/c/rs-learning/work/board?card=640006` (needs the fixture: the card of Omar's chat with Ads) |
| `card-chat-empty` | Board, an idea with Ads and no chat (`c-idea2`): its sheet on Chat, "No chat on this card yet" (#145) | `/c/rs-learning/work/board?card=640001` (needs the fixture: its idea with Ads) |
| `card-chat-locked` | Viewing as Youssef, a new chat to @Ads puts its card on the board; back as Omar, that card's sheet, Chat: the lock (#145) | `/c/rs-learning/work/board?card=640007`, Chat picked (needs the fixture: the card of the first Contributor's chat with Ads) |
| `agent-chat` | The Ads Agent's tile in the sidebar: a Conversation with an Agent other than Lead, with the private line of a team at its top (#25) | none |
| `agent-files` | That chat's details, Files tab: the files Ads works from (#21) | `/c/rs-learning/chat/61000000-0000-0000-0000-000000000002?tab=files` (the fixture's Ads; its files are the ones of its Cards and of the signed-in person's own Conversations with it) |
| `agent-screen` | The SEO Agent's chat, details on Activity: its screen card, asleep (#21). The product always shows the empty frame: the pinned Engine shows no Agent's screen | `/c/rs-learning/chat/61000000-0000-0000-0000-000000000002` (the fixture's Ads) |
| `settings` | Account menu, Settings: the overlay's Company section | `/c/rs-learning/settings` |
| `agents` | Settings, Agents | `/c/rs-learning/settings?section=agents` |
| `agent` | Settings, Agents, Lead: one Agent's page | `/c/rs-learning/settings?agent=61000000-0000-0000-0000-000000000001` (the fixture's Lead) |
| `apps` | Settings, Apps: the app catalogue (#30) | `/c/rs-learning/settings?section=apps` (needs a Company profile in the Engine) |
| `account` | Settings, Your account | `/c/rs-learning/settings?section=account` |
| `knowledge` | Settings, Company knowledge, on its first part, Brand voice (#27) | `/c/rs-learning/settings?section=knowledge` |
| `new-agent` | Sidebar, New agent: Lead's chat with the hint line (#13) | `/c/rs-learning/chat?new=agent` |
| `ready-roles` | New agent, then the hint line's "or pick a ready-made one": the ready-made gallery (#14) | `/c/rs-learning/chat?new=ready` (needs the fixture's Lead) |
| `made-card` | Sidebar, the chat in which Lead made Ads (`th-made-ads`), with the new Agent's card | none (a uuid path; with the fixture pass `--built-path /c/rs-learning/conversations/62000000-0000-0000-0000-000000000002`) |
| `draft-card` | Sidebar, the Meta campaign chat (`th-meta`), then the first angle: Ads's reply with the campaign plan's draft card under it (#136) | none (a uuid path; on the `draft-shown` visual state pass `--built-path /c/rs-learning/conversations/6d000000-0000-0000-0000-000000000003`) |
| `review-card` | Sidebar, the team chat (`th-team`): Critic's reply with the review card of the December ad texts under it (#137) | none (a uuid path; on the `review-shown` visual state pass `--built-path /c/rs-learning/conversations/6e000000-0000-0000-0000-000000000003`) |
| `made-agent` | Settings, Agents, Ads: the page of an Agent Lead made, with when and at whose request, and the rules it was told (#18) | `/c/rs-learning/settings?agent=61000000-0000-0000-0000-000000000002` (the fixture's Ads) |
| `rule-saved` | Sidebar, the chat in which Omar told Ads a lasting rule (`th-rule-ads`), with the saved line under Ads's reply (#18) | none (a uuid path; with the fixture pass `--built-path /c/rs-learning/conversations/62000000-0000-0000-0000-000000000003`) |
| `chat-on-board` | Sidebar, the chat with Ads about the Meta campaign (`th-meta`), with the corner pill "On the board" (#144) | none (a uuid path; pass `--built-path /c/rs-learning/conversations/<id>` of a chat with an Agent other than the main one whose first reply put its Card on the board) |
| `channel` | Sidebar, Channels, عام (`ch-general`): the general channel with its details panel (#23) | `/c/rs-learning/channels/69000000-0000-0000-0000-000000000001` (the seeded general channel; with the fixture it holds the reference's talk) |
| `ask-agent` | Viewing as Youssef (team), his "Ask for an agent" tile: Lead's chat with the Member's hint (#17) | `/c/rs-learning/chat?new=agent` (with `--sign-in reviewer@example.com`) |
| `request-sent` | Viewing as Youssef, his chat with Lead (`th-wa`) holding his request, not made yet (#17) | `/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003` (with `--sign-in reviewer@example.com`, over the visual state `agent-request`) |
| `request-waiting` | Omar's chat with Lead (`th-wa-req`): Youssef's request with No and Make it. The product decides it where it waits (#17) | `/c/rs-learning/approvals` (over the visual state `agent-request`) |
| `request-made` | Omar presses Make it, then viewing as Youssef, his chat with the made request (#17) | `/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003` (with `--sign-in reviewer@example.com`, over the visual state `agent-request-made`) |
| `new-channel` | Sidebar, Channels, "+": New channel, its name, Members and Agents (#24) | `/c/rs-learning/channels/69000000-0000-0000-0000-000000000001?new=channel` (over the general channel) |
| `team-channel` | Sidebar, Channels, حملة ديسمبر (`th-team`): a team channel with its members and Agents and their Remove and Add rows (#24) | none (a uuid path; pass `--built-path /c/rs-learning/channels/<id>` of a team channel) |
| `learning` | Settings, Learning: Youssef's rule for Ads in "Learning suggestions", with Decline and Make it team-wide (#25). The product decides it where it waits | `/c/rs-learning/approvals` (needs the fixture's suggestion) |

The built settings overlay is route-backed: `/c/<slug>/settings` opens it, `?section=<name>` opens a section and `?agent=<id>` one Agent's page, so each state has one address. The `agent`, `made-card`, `made-agent`, `ready-roles`, `rule-saved` and `learning` rows need the comparison fixture (below); on the seed alone the overlay shows the Agents list. "none" means the product has no equivalent page yet. Pass `--built-path` once a ticket builds one, and add it to the table in the same change.

Every screen starts from the prototype's default state. The "viewing as" switcher is touched only by the alone screens and by `ask-agent`, `request-sent` and `request-made`, which show Youssef, a Contributor (#17). To add a screen, add a row in `scripts/design-compare-lib.mjs` with its steps (`click`, `waitFor` or `scrollTo`, each with a CSS selector) and its built path.

### Where the database exists

The built side needs the app on the seeded local database. Without one, run the `Design compare` workflow (`.github/workflows/design-compare.yml`). It starts the local database and the production app, runs the command with the owner signed in, and uploads the images as the `design-compare` artifact. Its inputs are `screen`, `width`, `lang` and `theme`, with defaults `home`, `1440`, `ar` and `dark`. It also runs, with those defaults, on every pull request that changes the tool (`scripts/design-compare.mjs`, `scripts/design-compare-lib.mjs`), the workflow itself, or `design-reference/`. Download the `design-compare` artifact from that run.

```sh
gh workflow run design-compare.yml --ref <branch> -R omarabdo516/gtmworks
gh run download <run-id> -n design-compare -R omarabdo516/gtmworks
```

### Representative captures

The seed has no real Agents and no Conversations, so the default captures show an empty agent grid and a chat with no Agent attached. For a capture with the reference's five Agents (Lead the main one), a real main Agent and a populated Conversation, run the workflow with `fixture` checked. That loads `scripts/design-compare-fixture.sql` into the run's own fresh database before the capture. The tool itself never writes to a database, and the fixture refuses any database without the seed's Omar and test-only agent key, so it cannot touch a real installation. Pull request runs never load it.

```sh
# Lead's populated Conversation against the reference's main screen
gh workflow run design-compare.yml --ref <branch> -f screen=home -f fixture=true -f built_path=/c/rs-learning/conversations/62000000-0000-0000-0000-000000000001
# The main Agent's empty chat, with the full agent grid in the sidebar
gh workflow run design-compare.yml --ref <branch> -f screen=home -f fixture=true
# Another Agent's empty chat (Ads)
gh workflow run design-compare.yml --ref <branch> -f screen=agent-chat -f fixture=true -f built_path=/c/rs-learning/chat/61000000-0000-0000-0000-000000000002
# The chat in which Lead made Ads, with its card (#13)
gh workflow run design-compare.yml --ref <branch> -f screen=made-card -f fixture=true -f built_path=/c/rs-learning/conversations/62000000-0000-0000-0000-000000000002
# The ready-made gallery over Lead's New agent chat (#14)
gh workflow run design-compare.yml --ref <branch> -f screen=ready-roles -f fixture=true
# The chat in which Omar told Ads a lasting rule, with the saved line (#18)
gh workflow run design-compare.yml --ref <branch> -f screen=rule-saved -f fixture=true -f built_path=/c/rs-learning/conversations/62000000-0000-0000-0000-000000000003
# The first Contributor's rule for the team waiting in Omar's "Waiting on you", against the reference's Learning suggestions (#25)
gh workflow run design-compare.yml --ref <branch> -f screen=learning -f fixture=true
```

Add `-f lang=en`, `-f theme=light` and `-f width=390` for the other variants; both sides always use the same width, language and theme.

## Demo-only parts of the reference (do not build)

The prototype shows these so the screens look alive. They are not part of the product:

- The "viewing as" switcher and the three demo worlds.
- All seeded RS Learning people, Cards, messages and numbers in the prototype.
- Invented figures: usage prices, backup progress, subscription tiles.
- Email, phone or WhatsApp notifications.
- A private personal assistant per Member.
- An Agent publishing, spending or messaging a customer by itself.
- A public marketplace of Agents.
- The keyword matching that stands in for Lead creating an Agent. It is a stand-in and is not built.
- The GitLab wording, which is a slip. The product uses GitHub and "pull request".

The look comes from the approved prototype and the gtmworks design system, not Paperclip.
