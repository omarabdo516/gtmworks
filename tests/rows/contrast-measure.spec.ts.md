| `contrast-measure.spec.ts` | The contrast measure names a quiet label below 4.5:1 or one it cannot find and passes one at 4.5:1 weaker than the body text; names dark text below 4.5:1 and passes text at 4.5:1 or more, also on the canvas the dark scheme draws when no element sets a background. (moved from visual-lane-guards.spec.ts, #257, #805) | — | — | new (#805) |

## Cases

| `contrast-measure.spec.ts` "a quiet label below 4.5:1 is named, and one at 4.5:1 that stays weaker than the body text passes" | stays | The measure contrast.spec.ts trusts must fail on faint text, or a passing contrast check proves nothing (#218, #805). |
| `contrast-measure.spec.ts` "dark text below 4.5:1 is named, and text at 4.5:1 or more passes" | stays | The same for the dark theme's measure (#218, #805). |
| `contrast-measure.spec.ts` "dark text is measured on the canvas the dark scheme draws when no element sets a background" | stays | A dark page with no background of its own is measured on the dark canvas, not on white (#257, #805). |
