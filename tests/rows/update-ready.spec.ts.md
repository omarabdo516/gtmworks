| `update-ready.spec.ts` | Update ready (#442) in the whole app: the lane's app (gtmworks 0.0.1) reads a fake newer release at its lane address; the Owner sees Update ready with the release's entry and the command, hides it and it stays hidden after a reload, and a Manager sees nothing. | 8 s | components/update-ready.test.tsx (each state, without a server) | new |

## Cases

| `update-ready.spec.ts` "an Owner on an older version sees Update ready with what it brings and the command, and can hide it until the next one; a Member sees nothing" | stays | #442: a fake newer release at the lane's update address; the Owner opens Update ready (version, how long ago, the release's entry, `gtmworks update` with Copy), hides it and after a reload the same version stays hidden; a Manager sees no Update ready. |
