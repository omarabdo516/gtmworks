// Generated from DESIGN.md's front matter by `node scripts/design-tokens.mjs write`: never edit this file (#808).
// tests/design-values.test.mjs fails when it differs from the front matter. Read it through lib/design-css.mjs.
/** @type {{colors:Record<string,string>,rounded:Record<string,string>,spacing:Record<string,string>,shadows:Record<string,string>,typography:Record<string,Record<string,string|number>>}} */
export const designTokens={
 "colors": {
  "canvas": "#fafafa",
  "canvas-dark": "oklch(0.185 0 0)",
  "ink": "#262626",
  "ink-dark": "oklch(0.96 0 0)",
  "surface": "#ffffff",
  "surface-dark": "oklch(0.235 0 0)",
  "sidebar-grey": "#f1f1f1",
  "sidebar-grey-dark": "oklch(0.215 0 0)",
  "sidebar-hover": "#e3e3e3",
  "sidebar-hover-dark": "oklch(0.32 0 0)",
  "sidebar-hover-ink": "#202020",
  "sidebar-hover-ink-dark": "oklch(0.985 0 0)",
  "hairline": "#dedede",
  "hairline-dark": "oklch(1 0 0 / 11%)",
  "muted-fill": "#eeeeee",
  "muted-fill-dark": "oklch(0.29 0 0)",
  "muted-ink": "#5c5c5c",
  "muted-ink-dark": "oklch(0.74 0 0)",
  "hover-fill": "#ebebeb",
  "hover-fill-dark": "oklch(0.29 0 0)",
  "primary": "oklch(0.205 0 0)",
  "primary-dark": "oklch(0.922 0 0)",
  "primary-foreground": "oklch(0.985 0 0)",
  "primary-foreground-dark": "oklch(0.205 0 0)",
  "portal-surface": "oklch(1 0 0)",
  "portal-surface-dark": "oklch(0.235 0 0)",
  "portal-ink": "oklch(0.145 0 0)",
  "portal-ink-dark": "oklch(0.985 0 0)",
  "portal-muted-ink": "oklch(0.47 0 0)",
  "portal-muted-ink-dark": "oklch(0.74 0 0)",
  "portal-muted-fill": "oklch(0.97 0 0)",
  "portal-muted-fill-dark": "oklch(0.29 0 0)",
  "portal-hairline": "oklch(0.922 0 0)",
  "portal-hairline-dark": "oklch(1 0 0 / 12%)",
  "focus-ring": "oklch(0.708 0 0)",
  "focus-ring-dark": "oklch(0.556 0 0)",
  "destructive": "oklch(0.577 0.245 27.325)",
  "destructive-dark": "oklch(0.704 0.191 22.216)",
  "scrollbar-thumb": "oklch(0.7 0 0)",
  "scrollbar-thumb-dark": "oklch(0.4 0 0)",
  "agent-indigo": "#5A58DE",
  "agent-violet": "#8443D0",
  "agent-sky": "#2A6AD8",
  "agent-teal": "#117A80",
  "agent-jade": "#1B8253",
  "agent-rose": "#C23C86",
  "agent-dusk": "#8F52DC",
  "agent-slate": "#4D586B",
  "stage-amber": "oklch(55.5% 0.163 48.998)",
  "stage-blue": "oklch(48.8% 0.243 264.376)",
  "stage-violet": "oklch(49.1% 0.27 292.581)",
  "stage-green": "oklch(52.7% 0.154 150.069)",
  "gw-bg-chrome": "#FCFCFC",
  "gw-bg-chrome-dark": "#121212",
  "gw-bg-sidebar": "#F5F5F5",
  "gw-bg-sidebar-dark": "#0E0E0E",
  "gw-bg-pane": "#FFFFFF",
  "gw-bg-pane-dark": "#161616",
  "gw-bg-hover": "#1C1C1C0F",
  "gw-bg-hover-dark": "#F5F5F50F",
  "gw-bg-active": "#1C1C1C14",
  "gw-bg-active-dark": "#F5F5F514",
  "gw-bg-tertiary": "#1C1C1C0F",
  "gw-bg-tertiary-dark": "#F5F5F50F",
  "gw-bg-secondary-hover": "#1C1C1C1A",
  "gw-bg-secondary-hover-dark": "#F5F5F51A",
  "gw-bg-subtle": "#1C1C1C08",
  "gw-bg-subtle-dark": "#F5F5F505",
  "gw-bg-elevated-hover": "#F1F1F1",
  "gw-bg-elevated-hover-dark": "#2C2C2C",
  "gw-bg-active-solid": "#E9E9E9",
  "gw-bg-active-solid-dark": "#262626",
  "gw-bg-scrim": "#00000066",
  "gw-bg-scrim-dark": "#000000B2",
  "gw-text-1": "#1C1C1C",
  "gw-text-1-dark": "#F5F5F5",
  "gw-text-2": "#1C1C1CB8",
  "gw-text-2-dark": "#F5F5F5B8",
  "gw-text-3": "#1C1C1CA3",
  "gw-text-3-dark": "#F5F5F599",
  "gw-text-4": "#1C1C1C80",
  "gw-text-4-dark": "#F5F5F58A",
  "gw-border-1": "#1C1C1C3D",
  "gw-border-1-dark": "#F5F5F538",
  "gw-border-2": "#1C1C1C1F",
  "gw-border-2-dark": "#F5F5F51A",
  "gw-border-3": "#1C1C1C14",
  "gw-border-3-dark": "#F5F5F50F",
  "gw-primary": "#1C1C1C",
  "gw-primary-dark": "#F5F5F5",
  "gw-primary-hover": "#363636",
  "gw-primary-hover-dark": "#DBDBDB",
  "gw-on-primary": "#FCFCFC",
  "gw-on-primary-dark": "#121212",
  "gw-primary-disabled": "#1C1C1C26",
  "gw-primary-disabled-dark": "#F5F5F521",
  "gw-btn2-bg": "#1C1C1C0F",
  "gw-btn2-bg-dark": "#F5F5F524",
  "gw-btn2-ring": "transparent",
  "gw-btn2-ring-dark": "#F5F5F55C",
  "gw-btn2-hover": "#1C1C1C1A",
  "gw-btn2-hover-dark": "#F5F5F533",
  "gw-bubble-agent": "#1C1C1C0F",
  "gw-bubble-agent-dark": "#F5F5F50F",
  "gw-bubble-user": "#1C1C1C",
  "gw-bubble-user-dark": "#F5F5F52E",
  "gw-on-bubble-user": "#FFFFFF",
  "gw-on-bubble-user-dark": "#FFFFFF",
  "gw-accent": "#0F766E",
  "gw-accent-dark": "#2CC3AE",
  "gw-focus": "#0F766E",
  "gw-focus-dark": "#5EE0CC",
  "gw-wait-text": "#985500",
  "gw-wait-text-dark": "#F0A443",
  "gw-wait-bg": "#F5931217",
  "gw-wait-bg-dark": "#F694121F",
  "gw-danger-text": "#CD2834",
  "gw-danger-text-dark": "#FF6463",
  "gw-idle-dot": "#B5B5B5",
  "gw-idle-dot-dark": "#5C5C5C",
  "gw-wait": "#DA830E",
  "gw-wait-dark": "#E8962A"
 },
 "rounded": {
  "sm": "4.8px",
  "md": "6.4px",
  "lg": "8px",
  "xl": "11.2px",
  "2xl": "14.4px",
  "3xl": "17.6px",
  "4xl": "20.8px",
  "full": "999px",
  "circle": "50%",
  "gw-r-xs": "6px",
  "gw-r-sm": "8px",
  "gw-r-md": "12px",
  "gw-r-lg": "16px",
  "gw-r-bubble": "18px",
  "gw-r-composer": "22px",
  "gw-r-card": "24px",
  "gw-r-full": "9999px"
 },
 "spacing": {
  "unit": "4px",
  "xs": "4px",
  "sm": "8px",
  "md": "12px",
  "lg": "16px",
  "xl": "24px",
  "control": "36px",
  "touch-target": "44px",
  "toolbar": "44px",
  "sidebar": "240px",
  "topbar": "60px",
  "board-column": "260px",
  "card-aside": "320px",
  "gw-sidebar-w": "300px",
  "gw-details-w": "320px",
  "gw-chat-col": "620px",
  "gw-head-h": "64px"
 },
 "shadows": {
  "hint": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  "card-hover": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  "lift": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  "overlay": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "gw-shadow-pill": "#1C1C1C14 0 4px 12px -1px, #1C1C1C0A 0 1px 2px",
  "gw-shadow-pill-dark": "#F5F5F51A 0 0 0 0.5px",
  "gw-shadow-composer": "#0000000D 0 2px 8px -1px, #00000008 0 1px 2px",
  "gw-shadow-composer-dark": "#F5F5F51A 0 0 0 0.5px",
  "gw-shadow-popover": "#1C1C1C1A 0 10px 20px -3px, #1C1C1C14 0 4px 6px -4px",
  "gw-shadow-popover-dark": "#000000 0 10px 20px -3px, #F5F5F51A 0 0 0 0.5px",
  "gw-shadow-modal": "#1C1C1C1A 0 20px 32px -5px, #1C1C1C1A 0 8px 12px -6px",
  "gw-shadow-modal-dark": "#000000 0 20px 32px -5px, #F5F5F51A 0 0 0 0.5px",
  "gw-bubble-ring": "#1C1C1C0F 0 0 0 0.5px inset",
  "gw-bubble-ring-dark": "#F5F5F50F 0 0 0 0.5px inset",
  "gw-shadow-card": "#1C1C1C1F 0 0 0 0.5px, #1C1C1C09 0 2px 8px",
  "gw-shadow-card-dark": "#F5F5F51A 0 0 0 0.5px"
 },
 "typography": {
  "body": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "14px",
   "fontWeight": 400,
   "lineHeight": 1.5
  },
  "page-title": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "24px",
   "fontWeight": 600,
   "lineHeight": "32px",
   "letterSpacing": "-0.025em"
  },
  "section-title": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "16px",
   "fontWeight": 600,
   "lineHeight": "24px"
  },
  "subsection-title": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "14px",
   "fontWeight": 500,
   "lineHeight": 1.5
  },
  "nav-item": {
   "fontFamily": "var(--font-plex-arabic), \"IBM Plex Sans Arabic\", \"Noto Sans Arabic\", Tahoma, system-ui, sans-serif",
   "fontSize": "14px",
   "fontWeight": 400,
   "lineHeight": 1.6
  },
  "nav-group-label": {
   "fontFamily": "var(--font-plex-arabic), \"IBM Plex Sans Arabic\", \"Noto Sans Arabic\", Tahoma, system-ui, sans-serif",
   "fontSize": "13px",
   "fontWeight": 400,
   "lineHeight": 1.6
  },
  "column-title": {
   "fontFamily": "var(--font-plex-arabic), \"IBM Plex Sans Arabic\", \"Noto Sans Arabic\", Tahoma, system-ui, sans-serif",
   "fontSize": "14px",
   "fontWeight": 600,
   "lineHeight": "14px"
  },
  "toolbar-action": {
   "fontFamily": "var(--font-plex-arabic), \"IBM Plex Sans Arabic\", \"Noto Sans Arabic\", Tahoma, system-ui, sans-serif",
   "fontSize": "13px",
   "fontWeight": 600
  },
  "caption": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "12px",
   "fontWeight": 400,
   "lineHeight": 1.5
  },
  "identifier": {
   "fontFamily": "\"Paper Mono\", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
   "fontSize": "12px",
   "fontWeight": 400,
   "lineHeight": "16px"
  },
  "stat-figure": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "30px",
   "fontWeight": 600,
   "lineHeight": "36px",
   "letterSpacing": "-0.025em"
  },
  "brand": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "20px",
   "fontWeight": 600,
   "letterSpacing": "-1px"
  },
  "page-title-mobile": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "20px",
   "fontWeight": 600,
   "lineHeight": "28px",
   "letterSpacing": "-0.025em"
  },
  "stat-figure-mobile": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "24px",
   "fontWeight": 600,
   "lineHeight": "36px",
   "letterSpacing": "-0.025em"
  },
  "stat-figure-unavailable": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "20px",
   "fontWeight": 600,
   "lineHeight": "36px",
   "letterSpacing": "-0.025em"
  },
  "stat-figure-unavailable-mobile": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "18px",
   "fontWeight": 600,
   "lineHeight": "36px",
   "letterSpacing": "-0.025em"
  },
  "acceptance-figure": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "36px",
   "fontWeight": 600
  },
  "micro": {
   "fontFamily": "\"InterVariable\", \"Inter\", var(--font-arabic), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
   "fontSize": "11px",
   "fontWeight": 400
  },
  "gw-font": {
   "fontFamily": "var(--font-plex-arabic), \"IBM Plex Sans Arabic\", \"Noto Sans Arabic\", Tahoma, system-ui, sans-serif"
  },
  "gw-fs-xs": {
   "fontSize": "12px"
  },
  "gw-fs-sm": {
   "fontSize": "13px"
  },
  "gw-fs-base": {
   "fontSize": "14px"
  },
  "gw-fs-msg": {
   "fontSize": "15px"
  },
  "gw-fs-lg": {
   "fontSize": "17px"
  },
  "gw-fs-xl": {
   "fontSize": "22px"
  },
  "gw-fw-regular": {
   "fontWeight": 400
  },
  "gw-fw-medium": {
   "fontWeight": 500
  },
  "gw-fw-semibold": {
   "fontWeight": 600
  }
 }
};
