| `shared-engine.spec.ts` | The Owner is warned, in English and Arabic, while two companies share the bundled Engine profile. | 21.1 s | one-company-install.test.mjs (docs and logic) | keep (#218, case by case above) |

## Cases

| `shared-engine.spec.ts` "the Owner is warned while two companies share the bundled Engine profile, in English and Arabic" | stays | Company isolation: the only warning that a Company's agent memory is shared with another Company. The Company section asks the database for the signed-in Owner and draws the note, in English and Arabic, only while another Company shares the bundled profile. `supabase/tests/shared_engine.sql` checks the rule in the database alone; nothing faster checks that the page asks and draws it. |
