| `projects.spec.ts` | Projects are created, cards filed into them, Viewers read only, and a later change by someone else is not overwritten. | 23.3 s | — | keep (#218, case by case above); flaky cause fixed (#83) |

## Cases

| `projects.spec.ts` "a project is created, a card is filed into it, and the board and list show only that card" | stays | Real saves through the server and a journey across pages: a project is made and changed, a Card is filed into it from the Card, the board and the List filter by it, and the project page counts it, each read back after a reload. |
| `projects.spec.ts` "a viewer sees projects but cannot change them" | stays | Permissions: a signed-in Viewer reads the projects with no way to make or change one. |
| `projects.spec.ts` "once the server has the saved status, a later change by someone else shows and is not overwritten" | stays | A real save through the server: after someone else changes the saved status in the database, this page draws theirs and a later save keeps it. |
