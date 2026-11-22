| `question-picks.spec.ts` | On the app with the lane's fake Hermes (#648): an Agent asks with clarify a question where several may be picked; its card draws every choice, two of four picked and sent reach Hermes as the one JSON array it decodes for multi_select, and the card shows both picks with their checks, after a reload too; typed words answer the next such question as written. | — | supabase/tests/question_picks.sql (the picks kept, refused and logged), hermes-runs.test.mjs (the answer body), components/question-card.test.tsx (the toggles, Send and the answered rows) | new (#648) |

## Cases

| `question-picks.spec.ts` "a several-pick question draws its choices: two of four picked are sent as one answer and shown with their checks, and typed words answer the next" | stays | A journey across the card, the route, the database's claim, the closer and the Engine's clarify route: only the whole app sends the picks a person made to the Run that waits. |
