# Agent faces as living orbs: approved prototype

Approved by Omar on 2026-11-24: the orb (`agent-orb-v2.html`, round O2) and the window that changes a look (`agent-look.html`, round O3). It is the reference for every Agent's face; `design-reference/` and `design-reference-card/` stay the references for everything around it.

Open a file in a browser. Each has its own controls: language, theme, reduced motion; the second also has width, Role and "Next save fails". Nobody edits them; `(cd design-reference-orb && sha256sum -c SHA256SUMS)` proves it. A change needs a new approval.

| In `agent-orb-v2.html` | Section |
| --- | --- |
| Temperaments | 2, Meet the team ("No colour" shows them without hue) |
| Expressions, one per state | 3, Feelings |
| Birth, greeting, mentioned | 4, Moments |
| Sidebar, chat head, empty chat | 5, In place |
| Sizes | 6, Real sizes |

| In `agent-look.html` | Section |
| --- | --- |
| The pencil on the details' face (Owner), and any other Role's | 1, Where it opens from |
| "Change its look" on a made Agent's card, and its birth | 1 |
| The "Look" row in Settings | 1 |
| The window | opens from any of those; 2 shows it for six Agents |

Where the build differs, by decision 0067 and ADR 0027:

- A look is kept on the Agent, never computed from its name at drawing time; the picker in section 7 of the first file is replaced by the window.
- Past replies are 20px and still; only the reply being worked on is 24px and moves. The board's faces are 18 to 22px and still.
- Greeting plays the first time a day on a device; "done" only for work that ended well in front of the reader.
- In the second file, the editable Name in Settings and the "Won't do without asking you" line on the made Agent's card are the sample's, not approved.
- A face near or behind the window once drew its glow cut off in a square in a headless browser; the build must not.
