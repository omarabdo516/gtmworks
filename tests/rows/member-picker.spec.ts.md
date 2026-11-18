| `member-picker.spec.ts` | Saving a card unchanged clears a next actor who left the company. | 11.2 s | components/card-detail.test.tsx (the picker's removed default) | keep 1 of its 2 cases; 1 moved (#218, case by case above) |

## Cases

| `member-picker.spec.ts` "a removed MemberPicker default ${empty?'leaves the hidden input empty':'selects the first member'}" | moved | `components/card-detail.test.tsx` "a removed MemberPicker default ${empty ? 'leaves the hidden input empty' : 'selects the first member'}" (both forms, drawn in the browser instead of the server's markup, also checking the name shown). |
| `member-picker.spec.ts` "saving a card unchanged clears a next actor who was removed from the company" | stays | A real save through the server: saving a Card unchanged clears, in the database, a next actor who was removed from the Company, and the page reads it back empty after a reload. |
