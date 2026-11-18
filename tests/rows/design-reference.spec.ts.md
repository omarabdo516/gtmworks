| `design-reference.spec.ts` | The production build answers 404 for the design reference. | 0 s | design-reference.test.mjs (the files, not the route) | keep (#218, case by case above) |

## Cases

| `design-reference.spec.ts` "the production build answers 404 for the design reference" | stays | Only the production server shows what it answers at an address. `design-reference.test.mjs` "the product never serves the design reference" guards the known ways in (public/, a rewrite or redirect, a route of that name, the runtime image), not a route that reads files from disk. |
