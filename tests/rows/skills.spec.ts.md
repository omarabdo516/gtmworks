| `skills.spec.ts` | The skills screen lists and changes the skills in the main Agent's Hermes profile (#343). | 17.3 s | company-skills.test.mjs (the service) | keep (#218, case by case above) |

## Cases

| `skills.spec.ts` "the skills screen lists and changes the skills in the agent's Hermes profile" | stays | A real save through the server into a fake Engine (#343): the screen lists the main Agent's profile skills with the shared one marked, a SKILL.md with no header is refused and nothing is written, a written and an uploaded one reach the profile with their line endings as written, the skill is switched off and on for that Agent, each change is a line of the Company log, and a shared skill is never rewritten. The bilingual pictures come with it. |
| `skills.spec.ts` "a Viewer reads an agent's skills and is offered no change" | stays | Permissions on the real screen: a Viewer reads the main Agent's skills and is offered no write, upload or switch; `check_skill_write` refuses the change on the server (`supabase/tests/skill_writes_checked.sql`). |
