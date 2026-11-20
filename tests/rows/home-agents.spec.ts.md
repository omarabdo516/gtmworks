| `home-agents.spec.ts` | Home lists the Company's real Agents, the same ones in the same order the sidebar shows this reader, each with the Card it is working on now. (#460) | — | `lib/home-data.mjs`'s `currentAgentCard` (unit.test.mjs "an Agent works on its newest Card in progress, never one whose chat waits on a person"); supabase/tests/member_agent_visibility.sql (which Agents a reader sees) | new |

## Cases

| `home-agents.spec.ts` "a Company with only its main Agent finds one tile, named Lead, and no fixed role" | stays | A Company whose only Agent is its main Agent shows one tile on Home, named Lead, with none of the four legacy role Agents. |
| `home-agents.spec.ts` "a Member sees the main Agent first, then the made Agent shown to them, and no hidden Agent" | stays | The same Agents in the same order the sidebar shows a Contributor, main Agent first, and the Agent hidden from them has no tile. |
| `home-agents.spec.ts` "the Card an Agent is working on now is a link under its own tile, and the others are not working" | stays | An Agent's newest Card in the In progress column is a link to that Card under its own tile only, and every other tile reads Not working now. |
