| `shell-layout.spec.ts` | Two moves between a Company's pages from the sidebar (Home → Numbers → Activity log) ask the server for the page alone: no answer carries the sidebar, the sidebar stays the element drawn with the first page, and the open page's entry and title follow each move (#789). | 10 s | components/channel-list.test.tsx (the open channel read from the layout's address) | new |

## Cases

| `shell-layout.spec.ts` "two moves between a Company's pages read no sidebar again and keep the same sidebar" | stays | Only the real app shows which segments the server draws on a move: a component test has no router, and the layout's partial render is Next's. |
