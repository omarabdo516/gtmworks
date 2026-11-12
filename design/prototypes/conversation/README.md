# Conversation prototype (#185)

A throwaway, static look at the screens decided in #184: conversations with agents, the New composer, the agent face and page, and Hermes's own tasks shown as "Agent work". It is built from the copied Paperclip tokens (`components/paperclip/theme.css` and the repo fonts) with sample data only. Nothing is sent to any server and nothing is shipped: it is not a route, not in the app bundle, and adds no dependency. Two things are kept in the browser only: your language, theme and reduced-motion choices (`localStorage`, until you clear it) and, after you press Send in the New composer, the text of that one message (`sessionStorage`, until the tab closes) so the conversation screen can show it as your first message.

Open `index.html` in a browser (a file URL works; no server is needed). The strip at the top of every screen switches English and Arabic (and so right-to-left), light, dark and device theme, and reduced motion. The choice is saved in the browser and every screen opened afterwards (links, the back button) follows the one you made last. The same choices can also go in the address as a starting point: `?lang=ar&theme=dark&motion=reduce`; the address bar then drops them, so an old address never undoes a later switch. Add `&bare=1` to hide the strip and `&freeze=1` to stop the live conversation.

## Screens

"Follows" names the existing screen or component the layout is taken from. "New" means the app has no such screen and the design is free inside the same tokens.

| File | Screen | Follows |
| --- | --- | --- |
| `index.html` | The index: every screen, grouped | New (prototype only) |
| `composer.html` | New composer overlay: agent, project, mode, attachments, `@` and `/` lists, voice, model, effort, send. `?open=mention`, `?open=command`, `?open=agent` and `?open=voice` open each state | New; the dialog frame and menus follow Paperclip's dialog and menu (`components/paperclip/ui/`) |
| `conversation.html` | Conversation, live: the reply streams, steps, choice card, card row with live stage, Hermes tasks, handoff summary, share control, composer. `?t=6600&freeze=1` is mid-reply and `?t=end&freeze=1` is finished | New |
| `conversation-reopened.html` | A conversation reopened while the agent is still working | New |
| `conversation-unreachable.html` | Hermes cannot be reached: last known rows with "as of" and a time, typed text kept, send held | New |
| `card.html` | A card with its "Agent work" section and the link back to its conversation. `?origin=private` shows a private origin | `IssueDetail.tsx` (main column and properties column) |
| `card-unreachable.html` | The same card when Hermes cannot be reached | `IssueDetail.tsx` |
| `board.html` | The marketing board with its nine stages, unchanged | `KanbanBoard.tsx` |
| `agents.html` | Agents list with faces | The existing Agents screen, with faces added |
| `agent.html` | Agent page: large face whose eyes follow the pointer, section column, overview, properties. `?s=work`, `?s=skills`, `?s=settings` and `?s=settings&as=owner` | New page; the section column and properties column follow `IssueDetail.tsx` |
| `home.html` | Home with recent conversations in the sidebar and recent-activity rows | The existing Home screen, and `Layout.tsx` for the shell |
| `menu-account.html` | The account menu: settings, invite, theme, language, sign out | `Layout.tsx` and Paperclip's menu |
| `menu-company.html` | The company switcher | `SidebarCompanyMenu.tsx` |

The shared pieces are in `assets/`: `proto.css` (tokens and components), `proto.js` (shell, composer, face, rows), `screens.js` (one function per screen), `boot.js` (language and theme before first paint), `icons.js` (the lucide-react 1.48.0 icons the app already uses; Lucide's ISC licence and the MIT notice for its Feather-derived icons are in `Lucide-LICENSE.txt` beside it) and `fonts/` (Vazirmatn for Arabic, SIL OFL, the Arabic face `DESIGN.md` already names; Inter and Paper Mono come from `components/paperclip/fonts/`).

## What to look at, and what is only proposed

- The dark theme. The repo defines a `.dark` token set that no code applies, and no dark scope for the app shell. `proto.css` proposes one (`:root[data-theme="dark"]`). It is for approval, not an existing rule.
- The agent face is generated from the agent's name and tinted with its role colour, so it is the same everywhere. The eyes follow the pointer only inside the agent page header and stay still when the system asks for reduced motion (or the strip's "Reduce motion" is on). Every other animation and transition (status pulse, microphone wave, streaming caret, steps, reveals, the menu sheet) stops the same way.
- Agent work uses Hermes's own states (triage, to do, scheduled, ready, running, blocked, review, done) in a list. It is not a second board; the marketing board keeps its nine stages.
- Agents prepare work; approving, publishing and spending stay with people. No screen shows an agent doing any of those.
- Text a person writes or a command (`/skill`) keeps its own direction, so English in the Arabic screens, and the other way round, reads correctly.
- The agent picked in the New composer is the one the conversation opens with; the project, model and effort menus tick what was chosen last.
- Arabic text in this prototype is a working draft for review, not final copy.

## Checks (what was run for the PR)

- Every screen was loaded in Chromium in all eight combinations (English or Arabic, light or dark, 390 or 1440 wide) with no console or page error.
- Eyes: with the pointer moved around the large face the face's `--ex` and `--ey` change; with `prefers-reduced-motion: reduce` emulated they stay `0px`.
- `./ci.sh static` needs `lang="ar" dir="rtl"` in the source of every `design/**/*.html`; each file here carries it, and `boot.js` sets the real language and direction before first paint.
- The folder is outside `app/` and every import path, so `npm run build` cannot route or bundle it. One existing guard does read these files: the retired-palette test in `tests/unit.test.mjs` walks `design/` and reads every `.html` and `.css` file; it passes on them, and the test is unchanged.
