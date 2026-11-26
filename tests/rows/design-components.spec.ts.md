| `design-components.spec.ts` | Every component `DESIGN.md` names is drawn with its values: background, text colour, radius, padding, height, shadow and font, read from the computed styles where a screen of the seed draws it at 1440, in light and dark, in Arabic and English, and the hover of a button and a navigation item; a component with no place on a screen fails. | — | design-values.test.mjs (the tokens and the stylesheets) | new (#808) |

## Cases

| `design-components.spec.ts` "every component DESIGN.md names has a place on a screen, and only those" | stays | A component added to `DESIGN.md` is checked from the day it is named (#808). |
| `design-components.spec.ts` "every component is drawn with DESIGN.md's values in en, light and dark" | stays | A card has the design system's values, read from the page, never a picture (#805, #808). |
| `design-components.spec.ts` "every component is drawn with DESIGN.md's values in ar, light and dark" | stays | The same in Arabic, where the English sans stack is Vazirmatn's (#808). |
