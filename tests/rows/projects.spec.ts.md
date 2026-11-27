| `projects.spec.ts` | Projects are created, cards filed into them, Viewers read only, and a later change by someone else is not overwritten. | 23.3 s | — | keep (#218, case by case above); flaky cause fixed (#83) |

## Cases

| `projects.spec.ts` "a project is created, a card is filed into it, and the board and list show only that card" | removed | The board became the Engine's own Kanban board (#834); its Project filter returns with #837 as `kanban-card-edit.spec.ts` "a Project name set on a Card appears in the board's filter, and the filter shows only its Cards", the Project the Engine's tenant; the rest of the case stays in the next one. |
| `projects.spec.ts` "a project is created, a card is filed into it, and the list shows only that card" | removed | Renamed by #845 to "a project is created, a card is filed into it, and the project page counts it": the List reads the Engine's own Kanban board, whose Cards carry a Project name (the Engine's tenant), and its Project filter is proved by `kanban-views.spec.ts`. |
| `projects.spec.ts` "a project is created, a card is filed into it, and the project page counts it" | stays | Real saves through the server and a journey across pages: a project is made and changed, an old Card on its own page is filed into it, and the project page counts it, each read back after a reload. |
| `projects.spec.ts` "a viewer sees projects but cannot change them" | stays | Permissions: a signed-in Viewer reads the projects with no way to make or change one. |
| `projects.spec.ts` "once the server has the saved status, a later change by someone else shows and is not overwritten" | stays | A real save through the server: after someone else changes the saved status in the database, this page draws theirs and a later save keeps it. |
