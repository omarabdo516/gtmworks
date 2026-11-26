| `card-request.spec.ts` | The old board, on the board opened on Waiting on you (/approvals) since #834 made /work/board the Engine's own Kanban board, until #846 switches it off: A message to an agent makes one card in Ideas with its message, assignment and mode; the composer loads on open. | 8.6 s | — | keep (#218, case by case above) |

## Cases

| `card-request.spec.ts` "a message to an agent makes one card in Ideas with its message, assignment and mode, in both languages" | stays | A real save through the server: a message to an Agent makes exactly one Card in Ideas, also on a double click, with its message, its Agent and its mode, on the Card and the board, in both languages. |
| `card-request.spec.ts` "the composer loads when it is opened and shows the page-opening bar while it arrives" | stays | Only the built app shows it: the composer is its own script, fetched when New card opens, and the page-opening bar shows while it arrives. |
