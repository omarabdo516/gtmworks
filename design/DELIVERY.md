# Delivery records

Matching the frozen design (`design-reference/`), motion included, is a delivery check done once per screen, in the pull
request that ships it (Omar, 2026-11-17, #255). It is not a standing CI suite: the checks that compared the product with
the frozen reference on every change retired in #271. After delivery the product's own look is held by the small visual
lane (`docs/agents/visual-comparison.md`), and its behaviour by the tests in `docs/testing.md`.

How a delivery is recorded: [COMPARE.md, "The delivery record"](COMPARE.md#the-delivery-record).

## Screens

Each name is a screen of the comparison tool (`scripts/design-compare-lib.mjs`, described in [COMPARE.md](COMPARE.md#screen-names)).
The pull request is the one that added the screen to the tool, with its side-by-side capture in that pull request.

| Screen | Delivered in |
| --- | --- |
| `home` | #59 |
| `board` | #59 |
| `waiting` | #59 |
| `numbers` | #59 |
| `log` | #59 |
| `card-log` | #114 |
| `agent-chat` | #59 |
| `agent-files` | #208 |
| `agent-screen` | #208 |
| `agent-tools` | #330 |
| `agent-tools-manage` | #330 |
| `settings` | #59 |
| `invite` | #244 |
| `agents` | #59 |
| `agent` | #59 |
| `apps` | #112 |
| `account` | #59 |
| `knowledge` | #111 |
| `home-alone` | #88 |
| `settings-alone` | #88 |
| `new-agent` | #91 |
| `ready-roles` | #104 |
| `main-empty` | #292 |
| `new-agent-empty` | #292 |
| `made-card` | #91 |
| `draft-card` | #226 |
| `review-card` | #243 |
| `question-card` | #295 |
| `hand-card` | #301 |
| `permission-card` | #321 |
| `permission-waiting` | #330 |
| `permission-channel` | #330 |
| `connect-card` | #330 |
| `run-steps` | #304 |
| `rule-saved` | #106 |
| `chat-on-board` | #221 |
| `learning` | #110 |
| `made-agent` | #91 |
| `channel` | #109 |
| `ask-agent` | #117 |
| `request-sent` | #117 |
| `change-proposed` | #482 |
| `change-waiting` | #482 |
| `request-waiting` | #117 |
| `request-made` | #117 |
| `plus-menu` | #330 |
| `plus-menu-channel` | #330 |
| `plus-menu-model` | #330 |
| `plus-apps` | #330 |
| `new-channel` | #118 |
| `card-chat` | #237 |
| `card-chat-empty` | #237 |
| `card-chat-locked` | #237 |
| `account-menu-keys` | #250 |
| `new-chat-key` | #250 |
| `team-channel` | #118 |
| `chat-loading` | #253 |
| `numbers-loading` | #253 |
| `good-morning` | #506 |

## Motion

| What moves | Delivered in |
| --- | --- |
| The six motion tokens and the shared keyframes (#127) | #212 |
| Buttons, tiles, rows and chips fade and give under the press (#128) | #242 |
| The account menu rises, the switch springs, the composer and account row fade (#129) | #489 |
| Dialogs and full-window overlays leave with the 190 ms exit (#130) | #491 |
| The board: carried cards tilt, fly back and land; bars grow; counts pop (#131) | #490 |
| The conversation: messages rise, the thinking line breathes, the send arrow flies (#132) | #493 |
| Agent faces look, blink, hop and show an Agent at work (#133) | #494 |
| Numbers count up and a new Agent's tile flashes once (#134) | #492 |
| A screen fades in when it opens, and the sidebar row fades to current (#135) | #496 |

A screen added from now on records its own delivery in its pull request, in the format COMPARE.md gives, and adds its row here.
