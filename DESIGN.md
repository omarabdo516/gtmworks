---
name: gtmworks Look
description: Paperclip's neutral, monochrome control-room UI at a pinned commit, ported to gtmworks' existing screens in English and Arabic.
colors:
  canvas: '#fafafa'
  ink: '#262626'
  surface: '#ffffff'
  sidebar-grey: '#f1f1f1'
  sidebar-hover: '#e3e3e3'
  sidebar-hover-ink: '#202020'
  hairline: '#dedede'
  muted-fill: '#eeeeee'
  muted-ink: '#5c5c5c'
  hover-fill: '#ebebeb'
  primary: oklch(0.205 0 0)
  primary-foreground: oklch(0.985 0 0)
  portal-surface: oklch(1 0 0)
  portal-ink: oklch(0.145 0 0)
  portal-muted-ink: oklch(0.47 0 0)
  portal-muted-fill: oklch(0.97 0 0)
  portal-hairline: oklch(0.922 0 0)
  focus-ring: oklch(0.708 0 0)
  destructive: oklch(0.577 0.245 27.325)
  scrollbar-thumb: oklch(0.7 0 0)
  role-account-manager: '#a9c7dc'
  role-writer: '#b5d9cf'
  role-designer: '#d8baa9'
  role-critic: '#c5b8dc'
  role-arrow-agent: '#e5cb8d'
  stage-amber: oklch(55.5% 0.163 48.998)
  stage-blue: oklch(48.8% 0.243 264.376)
  stage-violet: oklch(49.1% 0.27 292.581)
  stage-green: oklch(52.7% 0.154 150.069)
typography:
  body:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  page-title:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.025em
  section-title:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
  subsection-title:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.5
  nav-item:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  nav-group-label:
    fontFamily: '"Paper Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.1em
  nav-group-label-recent:
    fontFamily: '"Paper Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 10px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: 0.1em
  column-title:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.025em
  caption:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  identifier:
    fontFamily: '"Paper Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  stat-figure:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 30px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.025em
  brand:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 20px
    fontWeight: 600
    letterSpacing: -1px
  page-title-mobile:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.025em
  stat-figure-mobile:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 24px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.025em
  stat-figure-unavailable:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 20px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.025em
  stat-figure-unavailable-mobile:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 18px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.025em
  acceptance-figure:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 36px
    fontWeight: 600
  micro:
    fontFamily: '"InterVariable", "Inter", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 11px
    fontWeight: 400
rounded:
  sm: 4.8px
  md: 6.4px
  lg: 8px
  xl: 11.2px
  2xl: 14.4px
  3xl: 17.6px
  4xl: 20.8px
  full: 999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  control: 36px
  touch-target: 44px
  toolbar: 44px
  sidebar: 240px
  topbar: 60px
  board-column: 260px
  card-aside: 320px
components:
  button:
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.md}'
    padding: 7px 12px
  button-hover:
    backgroundColor: '{colors.hover-fill}'
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.md}'
    padding: 7px 12px
  button-toolbar-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.canvas}'
    rounded: '{rounded.md}'
    padding: 7px 12px
    height: '{spacing.toolbar}'
  input:
    backgroundColor: transparent
    rounded: '{rounded.md}'
    padding: 6px 12px
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.xl}'
  board-card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: 10px
  nav-item:
    typography: '{typography.nav-item}'
    rounded: '{rounded.lg}'
    padding: 6px 8px
  nav-item-hover:
    backgroundColor: '{colors.sidebar-hover}'
    textColor: '{colors.sidebar-hover-ink}'
  nav-group-label:
    textColor: '{colors.muted-ink}'
    typography: '{typography.nav-group-label}'
    padding: 0px
  nav-group-label-recent:
    textColor: '{colors.muted-ink}'
    typography: '{typography.nav-group-label-recent}'
    padding: 6px 12px
  column-title:
    textColor: '{colors.muted-ink}'
    typography: '{typography.column-title}'
    padding: 8px 12px
  table-header:
    backgroundColor: '{colors.muted-fill}'
    textColor: '{colors.muted-ink}'
    padding: 10px 12px
  label-chip:
    rounded: '{rounded.sm}'
    padding: 2px 8px
    typography: '{typography.caption}'
  avatar:
    backgroundColor: '{colors.muted-fill}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    size: 24px
  stat:
    typography: '{typography.stat-figure}'
    rounded: '{rounded.lg}'
  dialog:
    backgroundColor: '{colors.portal-surface}'
    textColor: '{colors.portal-ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.xl}'
---

# Design System: gtmworks Look

## Overview

**Creative North Star: "The Quiet Control Room"**

gtmworks is an Operate-mode product: people direct agents, approve their work and read the numbers (`PRODUCT.md`). The look serves that job and gets out of the way. It is Paperclip's UI, a neutral monochrome workspace where white cards sit on an off-white canvas, colour is rare and always means something (a board stage, an agent's role, a label, an error). Existing screens are refined inside this identity, never redesigned.

The look is Paperclip's UI at commit `dc1adb7209bf8077983fdde8c1e8ab18405403b7` (`ui/`). Copy its code, colours, spacing, radius, Inter and Paper Mono fonts, Tailwind stack, Radix/shadcn primitives, shell, controls, menus, dialogs and motion. The former prototype and its motion limits are retired. `components/paperclip/` contains the scoped copies; `THIRD_PARTY_NOTICES.md` identifies every file, its source, adaptations and licences. Keep the MIT notice until the last substantial copy is replaced.

Only existing screens are ported: sign-in, company shell, Home, Work board/list/calendar, card creation/detail, Inbox, Agents and settings (including language and members), company selection and existing empty routes. Do not add Paperclip's org chart, costs, budgets, terminal, AI execution or other products. The database, permission rules, API and runs remain governed by the ADRs.

**Key Characteristics:**

- Paperclip at the pinned commit is the stated source of the look: its code, colours, spacing, radius, fonts, Tailwind stack, Radix/shadcn primitives, shell, controls, menus, dialogs and motion are copied, not re-drawn.
- Neutral greys carry the whole interface; the only hues are the four board-stage tones, the agents' role identity colours, the user-chosen label colours and the destructive red.
- One radius knob (8px) sets the corner ladder; Tailwind's 4px unit underlies the spacing, with a few product gaps between its steps (see Layout).
- English-first with a complete Modern Standard Arabic mirror: the layout flips at the inline axis, authored content keeps its own direction.
- Every interactive target is at least 44px on mobile, contrast meets WCAG AA, and reduced motion is respected.
- Every departure from Paperclip is listed with its reason in "Deviations and their reasons" below.

## Colors

A neutral palette with no brand accent. The shell (the signed-in app layout) runs in Paperclip's Coordinator workspace scope; dialogs, drawers, menus and the standalone panels render in portals and keep the root scope. Token values are in the frontmatter above and are normative; this section says where each is used.

### Primary

- **Graphite** (`primary`, with `primary-foreground` Near White): the primary button, the checkbox accent, the navigation progress bar and the acceptance meter. It is near-black, not a hue: emphasis comes from contrast, not colour.

### Neutral

- **Shell canvas** (`canvas`): the page behind everything in the shell. **Surface** (`surface`): white cards, panels and board cards that sit on it. **Ink** (`ink`): the shell's foreground token, painted as the text on cards and panels (`card-foreground`), as the 80% mix of navigation links and as the fill of the toolbar primary button; running text that sits directly on the canvas inherits the root's near-black (`portal-ink`) from the body, because the shell scope redefines the token but nothing applies it to the canvas itself. **Muted Ink** (`muted-ink`): secondary text, captions, column titles and placeholders. **Hairline** (`hairline`): every 1px border and divider. **Muted Fill** (`muted-fill`) and **Hover Fill** (`hover-fill`): table headers, avatars, chip backgrounds and hover states.
- **Sidebar Hover** (`sidebar-hover`) with its ink (`sidebar-hover-ink`): the hover, pressed and active state of a navigation item. The rail itself paints `--primary-sidebar-background`, which is declared once on `:root` as a 50% mix of `--border` over `--background` (srgb). Because it is declared on `:root`, the mix is resolved there from the root values (`oklch(0.922 0 0)` over `oklch(1 0 0)`, rendered `#f2f2f2`) and the inherited result is used unchanged inside `.app-layout`; the shell's own Hairline (`#dedede`) and Canvas (`#fafafa`) do not feed into it; the scope's `sidebar-grey` token is defined but the rail does not use it.
- **Portal scope** (`portal-surface`, `portal-ink`, `portal-muted-ink`, `portal-muted-fill`, `portal-hairline`): the same roles in the root tokens, for dialogs, drawers, menus and the standalone sign-in and no-company panels.
- **Focus Ring** (`focus-ring`): focus outline and the 3px halo around focused controls. **Scrollbar Thumb** (`scrollbar-thumb`): the 8px scrollbar.
- **Alarm Red** (`destructive`): destructive buttons, error notices and rejection reasons, on a 10% tint of itself (`.work-error`).

### Secondary

- **Role identity colours** (`role-account-manager`, `role-writer`, `role-designer`, `role-critic`, `role-arrow-agent`): soft pastel identifiers for the account manager, writer, designer and critic roles and the fifth seeded agent (symbol `↗`). They tint avatars, role glyphs and mode chips so the same role is recognisable in navigation, Home and cards.
- **Board stage tones** (`stage-amber`, `stage-blue`, `stage-violet`, `stage-green`): Paperclip's neutral, amber, blue, violet and green column recipes, mapped onto the company's nine stages in order (neutral, amber, blue, violet, violet, green, blue, green, neutral). The frontmatter lists each hue's text tone (Tailwind 4.3.3 palette, `-700`); the column body uses the same hue at 45% of its `-50` tint with a `-500` ring at 15% (`components/paperclip/KanbanBoard.tsx:11-22`).
- Label colours on cards are data chosen by each company in settings, not design tokens.

### Named Rules

**The Neutral Canvas Rule.** Chrome is grey. A hue appears only as a board-stage tone, a role identity, a user-chosen label colour or the destructive red of an error or destructive action; never as decoration or as a brand accent.

**The Two Scopes Rule.** Shell surfaces use the Coordinator tokens; anything rendered in a portal uses the root tokens, exactly as upstream does. Do not copy a shell colour into a portal or the reverse.

**The Device-First Theme Rule (#186).** The server renders `data-theme="device"` unless the person saved Light or Dark (or explicitly Device). CSS `color-scheme` and `light-dark()` choose tokens before first paint, including portals, without hydration or local storage. The approved #185 prototype supplies the dark shell: canvas `oklch(0.185 0 0)`, ink `oklch(0.96 0 0)`, cards `oklch(0.235 0 0)`, sidebar `oklch(0.215 0 0)`, muted/accent `oklch(0.29 0 0)` and muted ink `oklch(0.74 0 0)`. Portals use the prototype's `0.235` surface and `0.985` ink. Light values stay unchanged. The profile opens an account menu with Light, Dark and Device radio choices; the choice is saved on the person like language. Anonymous sign-in follows the device. Pastel agent avatars keep dark ink for contrast. The chart tokens remain unassigned; bars use foreground.

## Typography

**Sans Font:** Inter (variable, bundled; `InterVariable`), then `var(--font-arabic)` (Vazirmatn, supplied by `next/font` in `app/layout.tsx`), then system sans. In Arabic the whole sans stack is replaced by `var(--font-arabic), sans-serif` (`app/globals.css`, `html[lang=ar]`), so the frontmatter stack is the English one.
**Mono Font:** Paper Mono (variable, bundled) for identifiers and English navigation group labels.

**Character:** a quiet, dense product voice: small sizes (12 to 14px), a single semibold weight for emphasis and tight tracking only on the big numbers and the page title. Both font licences ship beside the copied fonts.

### Hierarchy

- **Page title** (600, 24px / 32px, tracking -0.025em; 20px / 28px below 768px): one per screen, `h1`.
- **Section title** (600, 16px / 24px): panel and group headings, `h2`.
- **Subsection title** (500, 14px): `h3`, including card-detail section headings.
- **Body** (400, 14px / 1.5): all running text and form fields.
- **Navigation item** (500, 13px): sidebar links. **Navigation group label** (Paper Mono 500, 10px, uppercase, tracking 0.1em): English only; Arabic uses Vazirmatn with normal tracking (`html[lang=ar] .nav-group h2`). The copied `SidebarSection` headings (navigation and agents groups) have no padding and normal line height (1.5); the fallback `.nav-group h2` rule, which the Recent group still uses, gives 24px line height and 6px 12px padding (`typography.nav-group-label-recent`).
- **Column title** (600, 12px / 16px, uppercase, tracking 0.025em, muted ink): board column headers.
- **Caption** (400, 12px): dates, channels, helper lines and chips. **Identifier** (Paper Mono, 12px / 16px): card ids.
- **Stat figure** (600, 30px / 36px, tracking -0.025em; 24px below 768px): the four Home work figures. A figure that is unavailable drops to 20px (18px below 768px) in muted ink; the acceptance meter's figure is 36px.
- **Brand** (600, 20px, tracking -1px): the wordmark. **Micro** (400, 11px): the author chip on a card conversation.

### Named Rules

**The Language Font Rule.** Vazirmatn is used for Arabic only; English stays on Inter. Digits keep Western order in both languages.

**The Mono Is For Identifiers Rule.** Paper Mono marks ids and navigation group labels, never body copy.

## Layout

A fixed shell: a 240px sidebar (a slide-in sheet below 768px, on the inline-start side in either direction), a 60px top bar carrying the breadcrumb, and a scrolling content area padded 24px (16px with 80px at the bottom on phones, which clears the mobile bottom bar). The page itself never scrolls; the shell does. Spacing is Tailwind's 4px unit (`spacing.unit`); the main steps are 4, 8, 12, 16 and 24, with a few smaller gaps between them (2, 3, 6 and 10px).

Work screens use fixed-width board columns (260px) that scroll sideways, a 7-column calendar grid (700px minimum), and a card detail page split into a main column and a 320px properties column that stacks on phones. Home is a grid of four role tiles, four stat tiles and three charts: the role tiles are four columns on desktop, two at 1100px and below and one below 768px; the stat tiles stay four until 767px and then two; the charts are three columns, one at 1100px and below. Tables keep a 650px minimum width on phones and scroll inside their panel.

Direction follows the language: the layout mirrors at the inline axis (sidebar, drawer side, board flow, menus, controls) through logical properties, while authored titles and names keep automatic direction. Touch targets are at least 44px on mobile (`spacing.touch-target`).

### Named Rules

**The Logical Axis Rule.** Prefer inline-start and inline-end properties to left and right, so one stylesheet serves both languages. Physical coordinates stay only where they are already a mirrored pair or a centring idiom: the copied dialog centres with `left: 50%` and a -50% translate (`components/paperclip/ui/dialog.tsx`), and the native select places its caret from the left or the right according to `:dir(rtl)` (`components/paperclip/theme.css`).

## Elevation & Depth

Flat by default. Depth comes from tonal layering (white surface on an off-white canvas) and a 1px hairline border, not from shadow. Shadows are reserved for state or true overlay.

### Shadow Vocabulary

- **Hint** (`shadow-xs`, `0 1px 2px 0 rgb(0 0 0 / 0.05)`): outline buttons and text inputs (`components/paperclip/ui/button.tsx`, `input.tsx`).
- **Pickup** (`0 1px 3px #0002`): the stylesheet's board-card hover (`app/globals.css`, `.card:hover`). The live board card (`KanbanCard`, `components/paperclip/KanbanBoard.tsx`) also carries `hover:shadow-sm` (`0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`), which is in the utilities layer and so is the shadow shown on hover.
- **Lift** (`shadow-md`, `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): an interactive Paperclip card on hover.
- **Overlay** (`shadow-lg`, `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` over a `bg-black/50` scrim): dialogs.
- **Focus** (`outline: 2px solid var(--ring); outline-offset: 2px` on `:focus-visible`; the copied `Button` and `Input` replace the outline with a 3px ring at 50% of the ring colour, `focus-visible:ring-ring/50`; the destructive `Button` variant instead uses a 3px ring at 20% of the destructive colour, `focus-visible:ring-destructive/20`): never removed. The root also defines a 3px halo at 20% of the ring colour (`--focus-ring-halo`, `components/paperclip/theme.css`); the copied controls do not apply it.

### Named Rules

**The Flat-By-Default Rule.** A surface is flat at rest. A shadow answers a state (hover, pickup, overlay), with one standing exception: the copied outline button and text input carry the Hint shadow at rest.

## Shapes

One radius knob, `--radius: 0.5rem` (8px), drives a multiplicative ladder: `sm` 0.6, `md` 0.8, `lg` 1.0, `xl` 1.4, `2xl` 1.8, `3xl` 2.2 and `4xl` 2.6 times the knob. Retune the whole corner language by editing the knob alone (`components/paperclip/theme.css`, comment above the ladder).

- **Cards, panels, navigation items and dialogs:** `lg` (8px).
- **Buttons, inputs, selects, table-adjacent controls and column bodies:** `md` (6.4px).
- **Chips, calendar entries and bar tracks:** `sm` (4.8px).
- **Avatars, dots, label bars and badges:** fully round.
- Borders are 1px hairlines. A board column body is a tinted rounded area with an inset ring, not a bordered box.

## Components

### Buttons

- **Shape:** `md` radius (6.4px), 36px minimum height (a multi-line label grows it; `spacing.control`), 7px 12px padding, 14px medium text.
- **Default:** canvas fill, hairline border, text inherited from its parent (ink inside cards and panels); hover fills with hover fill. **Primary** (`button.primary`): graphite fill, near-white text. **Toolbar primary** (the New card action): ink fill, canvas text, 44px high, 12px inline padding with the button's 7px block padding, semibold, hover mixes 10% toward the surface (`components/paperclip/theme.css`).
- **Paperclip `Button`** (the copied component, `data-slot="button"`): variants default, cta, destructive, outline, secondary, ghost and link, sizes xs to lg and icon; used for the shell's controls.
- **Disabled:** 50% opacity, default cursor.

### Inputs / Fields

- **Style:** transparent fill, 1px `input` border, `md` radius, 36px minimum height (`spacing.control`), 6px 12px padding; a text area has a 96px minimum height and the card caption field grows with its text and keeps its line breaks.
- **Focus:** the 2px ring outline; Paperclip's `Input` replaces it with a ring-coloured border and a 3px ring at 50%. **Placeholder:** muted ink at full opacity (contrast reasons recorded in the stylesheet). **Autofill:** repainted in the app's own muted fill so it never goes blue.
- **Error:** destructive border and a 20% destructive ring on `aria-invalid`.

### Navigation

- **Sidebar:** 240px, the rail described under Colors (the root-resolved 50% mix, `#f2f2f2`), hairline on the inline-end edge; items are 13px medium, 32px minimum height, `lg` radius, 6px 8px padding, with a role glyph or icon; hover and pressed use `sidebar-hover` with `sidebar-hover-ink`. Group labels use the mono 10px uppercase style (Arabic: Vazirmatn, normal tracking).
- **Mobile:** a bottom bar (Home, Work, New card when permitted, Agents, Inbox) that slides away on scroll down and back on scroll up, and the sidebar as a sheet.
- **Breadcrumb:** in the top bar, Work › card title and company › Settings › page; the last crumb truncates.
- **Tabs:** pill links on a transparent row; the active one takes `accent`.

### Panels / Containers

- **Panel:** `surface` fill, 1px hairline, `lg` radius, 24px padding (16px for the Home role tiles). Title 16px semibold, body in muted ink.
- **Table:** full-width panel, header cells on `muted-fill` with muted-ink 500 text, 10px 12px cell padding, row hover on `accent`.

### Board

- **Column:** 260px wide; a column header (12px semibold uppercase, count at the inline end, tabular figures) over a tinted body at the stage tone. An empty column says so in muted caption text and keeps its Add card action.
- **Card:** `surface`, 1px hairline, `lg` radius, 10px padding, a `grab` cursor, label bars (24 by 4px, fully round) above the title, the id in mono, then channel and date, mode chip, checklist progress and assignee avatars at the inline end. Titles clamp to two lines.
- **Dragging:** Paperclip's pointer sensor and overlay, with localized announcements.

### Chips, Avatars and Stats

- **Label chip:** 1px border in the label's own colour, `sm` radius, 2px 8px padding, 12px text. **Mode chip:** the same, with 1px 8px padding and an 8px dot in the assigned role's colour. **Author chip:** muted 11px text with a role dot.
- **Avatar:** people keep a 24px circle on `muted-fill` with an initial. Agents use the generated face from `design/prototypes/conversation/assets/proto.js`: role-coloured head, two eyes, mouth and identity-derived shape/accessories. The shared global agent id seeds the face; it never changes with company or language. Faces are still (no blinking or eye-following) and have the agent's name as their text alternative.
- **Stat:** the figure (30px semibold) above its 14px muted label; an unavailable figure is shown at 20px in muted ink.

### Dialog

- A centred Radix dialog on the root tokens: 512px maximum width (the viewport width less 2rem below the `sm` breakpoint), `lg` radius, 24px padding, `Overlay` shadow over a 50% black scrim; on phones it sits near the top. The card-detail route renders the same surface as a page, with a 44px close link at the inline end of the heading.

### Motion

Motion is Paperclip's own and kept quiet: 80ms and 160ms for hover and colour changes, 240ms, 360ms and 520ms for panes and the mobile bar (which enters on an ease-out-expo curve and leaves on a standard ease). The values are in the sidecar. Under `prefers-reduced-motion` every transition and animation is cut to zero. Navigation feedback is a 3px bar at the top of the page. The sign-in screen's ASCII animation (`components/paperclip/AsciiArtAnimation.tsx`) runs continuously and shows a static frame under reduced motion.

## Do's and Don'ts

### Do:

- **Do** read a value from `components/paperclip/theme.css` or the copied component before inventing one; the pinned Paperclip commit is the source.
- **Do** keep chrome grey and use a hue only for stage, role, label or error meaning.
- **Do** use logical properties and check every new screen mirrored in Arabic as well as in English; add every interface string to both catalogues.
- **Do** keep targets at 44px or more on mobile and text at WCAG AA contrast.
- **Do** put a new Paperclip-less screen (conversation, agent face, agent page) on the same tokens and radius ladder, with design freedom inside them (`PRODUCT.md`).
- **Do** record any new departure from Paperclip under "Deviations and their reasons" with its reason.

### Don't:

- **Don't** add Paperclip's org chart, costs, budgets, terminal, AI execution or other products; only existing screens are ported.
- **Don't** add an upstream feature to manufacture parity with Paperclip.
- **Don't** introduce a brand accent colour: the identity is Paperclip's (`PRODUCT.md`, Brand Commitments).
- **Don't** hard-code a radius or colour that a token already carries.
- **Don't** raise the JavaScript budget to fit a feature; load what only appears after a click or a drag lazily (see "JavaScript budget").
- **Don't** present a redrawn picture as Paperclip reference evidence; reference screenshots come from the local upstream run.

## Deviations and their reasons

- **Agent faces (#188):** the approved conversation prototype replaces role glyphs with generated faces in the sidebar, Home, work, threads, pickers, agent/skill settings and activity. Existing role colours and people’s initials stay. Pickers use the copied Paperclip menu so each option can show a face; native select options cannot render SVG.
- **Shared agent names:** `agent_identities()` exposes only global agent id, role and name to signed-in people, independently of company grants. It keeps historical faces named after revocation without widening access to people or company data.
- **Arabic/RTL:** the same layout mirrors at the inline axis, including sidebar placement, drawer side, board flow, menus and controls. Authored titles, company/person names and other content keep automatic direction; digits retain Western order. The full Modern Standard Arabic catalogue ships alongside English. Interface strings come from both catalogues.
- **Nine stages:** retain the company's existing stage names and order. Paperclip's neutral, amber, blue, violet and green column recipes map onto these stages; no Paperclip status is added to the database.
- **Sidebar items:** retain gtmworks navigation groups, item order, account manager/writer/designer/critic and recent cards. Existing role glyphs, identity colours and member avatars identify the same roles and people across navigation, Home and cards. The mobile bar uses Home, Work, New card (when permitted), Agents and Inbox. The company chooser uses existing memberships and routes. Search opens the existing localized unavailable screen because this product has no search backend yet. Unbuilt routes use the copied generic EmptyState inside a neutral panel, without Paperclip's route-specific illustrations, search or create controls whose operations are unavailable here. No out-of-scope navigation is added.
- **Vazirmatn:** used for Arabic only, including Arabic navigation headings. English uses Paperclip's bundled Inter, with Paper Mono for identifiers and English navigation group labels. Both font licences ship beside the copied fonts.
- **Product identity and authentication:** gtmworks wordmark and catalogue copy replace Paperclip's identity. Supabase email-link sign-in replaces its email/password inputs; its split form/animation layout remains. A public language selector replaces the theme-toggle slot so anonymous sign-in and confirmation messages can be inspected in both languages; this preview does not replace the saved account preference. Existing invitations and MFA stay functional.
- **Home content:** retain four role tiles, four work figures, the three existing charts and recent activity/cards. Pending approvals, ownership and audited transitions supply the same numbers as before. Delivered work is an audited transition to stable key `approved`; first-time acceptance excludes earlier rejections. Charts cover the last 14 UTC calendar days. Publishing, bookings and stopped-card status remain Unavailable; acceptance without deliveries remains Unavailable. These content-specific charts use the copied neutral card and metric surfaces.
- **Work controls:** retain the Board/Calendar/List links, creative preview toggle, month filter and per-stage Add card actions. These replace task-search, column, page-size and task-filter controls whose data and operations are outside this ticket. List keeps the existing sortable title, stage, channel, publishing date and next actor columns in a neutral table with the copied row recipes, rather than Paperclip's compact task rows, so those marketing fields remain readable and sortable. Card dragging uses Paperclip's pointer sensor and overlay with localized announcements.
- **Card content:** keep gtmworks labels, creative preview toggle, dates/channel, checklist progress, assignees, card templates, marketing fields, approval decisions and evidence uploads. Detail uses Paperclip's page surface, a main marketing/content/activity column and its narrower properties column. A localized 44px close link at the inline end of the detail heading returns to the board, preserving the route-backed editor's return action with clear title space in both directions. Card creation uses its dialog surface. Creating, editing, commenting, approvals and moves call the existing server actions. These fields replace Paperclip's task/run/project properties; no unrelated task controls are introduced.
- **Palette and motion follow the running upstream shell.** Paperclip's shell at the pinned commit applies its Coordinator workspace tokens (`ui/src/index.css`, `.coordinator-workspace`): off-white `#fafafa` canvas, white cards, `#f1f1f1` sidebar and the neutral greys. `components/paperclip/theme.css` copies that scope onto `.app-layout`; portal surfaces (dialogs, drawers, menus) keep the root tokens, as upstream does. Dialog, drawer and menu classes such as `animate-in` and `zoom-in-[0.97]` are copied with their files but are inert upstream too, because the `tw-animate-css` plugin is not installed there (the pinned `ui/src/index.css` records this next to its dialog and alert-dialog allowances), so those surfaces appear without entrance motion in both products. The motion we do ship is Paperclip's own transitions and tokens.
- **Breadcrumbs:** card detail shows Work › card title and the settings pages show company › Settings › page, as Paperclip's top bar does. The company name keeps its own spelling instead of Paperclip's uppercase, and card detail starts from the Work stage instead of Paperclip's "TASKS" because our sections are named by the sidebar catalogue.
- **Touch access:** retain the existing minimum 44px targets for member/invitation controls, stage selectors and checklist boxes on mobile. These preserve existing accessibility contracts.
- **Settings and other existing content:** language, memberships, agent API keys/webhooks, approval steps and the calendar retain their data and operations inside the copied controls and neutral surfaces. Settings keeps the existing General/Members/Work/Agents tabs instead of Paperclip's organization-settings sidebar because only those settings exist here. Inbox keeps its approval queue and review actions; Paperclip's search and unread/filter toolbar are omitted because this product has no corresponding operations. No-company and not-found retain standalone neutral panels instead of a company shell, since a person without membership or access cannot enter that company. Language remains an account preference across sessions and devices. No Paperclip settings or integrations are added.
- **Product-only states are reversible interpretations:** the pinned UI has no native marketing calendar, nine-stage editor, company-scoped legacy agent API-key/webhook settings, Supabase email-link confirmation, Supabase invitation acceptance or gtmworks MFA screen. These retain existing behavior using the copied controls and neutral surfaces. Compare the calendar with upstream Tasks list, stage settings with organization settings, API/webhook settings with Connectors, authentication states with upstream authentication, and the no-company panel with upstream organization selection. These are explicitly nearest-surface comparisons, never exact matches or evidence of a native counterpart. Revisit the interpretation when the product gains its own approved screen design; do not add an upstream feature to manufacture parity.

## JavaScript budget

The mandatory copied Radix/shadcn kit and styling helpers replace the previous UI dependency baseline. The local production Home route measured 261,524 bytes gzip with the copied primitives, sidebar disclosures, drag sensor and overlay. The previous 200 KB route limit was set together with the v1 look. On 2026-11-08 Hermes decided, as a reversible technical choice recorded on issue #98, to cap all existing routes at 256 KiB (262,144 bytes) gzip in the production route guard, the measured cost of the required Paperclip kit. Issue #154 lowered the cap to 230 KiB (235,520 bytes): the Supabase browser client (about 69 KB gzip) was the largest part of every page and only the authenticator form and the email-link page need it, so the sidebar's Recent list now reads and records visits through the server route `/api/recent-cards`, and the authenticator form loads the client when it is used. Every company route then measured 192,844 bytes. The budget is a ceiling for the required kit, not permission to add unrelated UI or dependencies; a card that adds UI and approaches the 230 KiB ceiling loads the part that only appears after a click or a drag lazily. Navigation feedback, prefetch, cache invalidation and reduced-motion tests remain enforced.

## Visual evidence and review

Capture the local Paperclip UI from the pinned checkout and gtmworks from the committed implementation at 1440×900 and 390×900, in English and Arabic. Include sign-in, Home/shell, board, list, card detail, Agents and language settings, plus other existing routes. Record fixture setup, source commits, viewport, language and capture hashes with the side-by-side pairs. Reference screenshots must come from the local upstream run, never a redrawn reference.

Label every pair with its actual upstream route and whether it is a corresponding screen or a nearest surface for a product-only state. Exercise the pinned upstream Arabic catalogue where available and disclose English fallback text and any direction applied by the capture harness; a requested Arabic locale is not proof of a complete upstream Arabic translation. Record redirects, errors and unavailable states as limitations instead of presenting their captures as settled corresponding screens.

The merge reviewer must inspect every pair against the deviations above. An unexplained difference is a failed visual review and must be fixed or explicitly approved as a deviation before merge. Passing functional CI alone does not establish visual parity. PR publication and the remote merge gate are separate delivery steps; local evidence is prepared before publication.
