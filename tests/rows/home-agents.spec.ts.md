| `home-agents.spec.ts` | Home lists the Company's real Agents, the same ones in the same order the sidebar shows this reader, each with the Card it is working on now: its newest In progress on the Company's Engine board, read in the browser (#460, #846). | — | supabase/tests/member_agent_visibility.sql (which Agents a reader sees) | new |

## Cases

| `home-agents.spec.ts` "a Company with only its main Agent finds one tile, named Lead, and no fixed role" | stays | A Company whose only Agent is its main Agent shows one tile on Home, named Lead, with none of the four legacy role Agents. |
| `home-agents.spec.ts` "a Member sees the main Agent first, then the made Agent shown to them, and no hidden Agent" | stays | The same Agents in the same order the sidebar shows a Contributor, main Agent first, and the Agent hidden from them has no tile. |
| `home-agents.spec.ts` "the Card an Agent is working on now is a link under its own tile, and the others are not working" | stays | An Agent's Card In progress on the fake Engine's board is a link that opens it over the board, under its own tile only (a Card of its in Planned is not), and every other tile reads Not working now (since #846 on the Engine's board, no longer the old one's). |
