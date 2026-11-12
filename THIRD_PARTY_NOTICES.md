# Third-party notices

## Paperclip UI

Source: https://github.com/paperclipai/paperclip/tree/dc1adb7209bf8077983fdde8c1e8ab18405403b7/ui

Pinned commit: `dc1adb7209bf8077983fdde8c1e8ab18405403b7`. Copied UI stays in `components/paperclip/`. Keep this notice while any substantial copied code remains. Remove individual rows only when the corresponding copy is removed or fully replaced.

MIT License

Copyright (c) 2025 Paperclip AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## File inventory

Adaptations bind gtmworks data, routing and both message catalogues, preserve authored text direction, and omit out-of-scope product features. Font binaries use SIL OFL 1.1, not MIT.

| Local file | Classification | Upstream source (under ui/) |
| --- | --- | --- |
| `components/paperclip/AsciiArtAnimation.tsx` | Copied and adapted | `src/components/AsciiArtAnimation.tsx` |
| `components/paperclip/Auth.tsx` | Copied and adapted | `src/pages/Auth.tsx` |
| `components/paperclip/ChartCard.tsx` | Copied and adapted | `src/components/ActivityCharts.tsx (ChartCard only)` |
| `components/paperclip/EmptyState.tsx` | Copied and adapted | `src/components/EmptyState.tsx` |
| `components/paperclip/IssueDetail.tsx` | Copied and adapted | `src/pages/IssueDetail.tsx` |
| `components/paperclip/KanbanBoard.tsx` | Copied and adapted | `src/components/KanbanBoard.tsx` |
| `components/paperclip/Layout.tsx` | Copied and adapted | `src/components/Layout.tsx; src/components/BreadcrumbBar.tsx` |
| `components/paperclip/MetricCard.tsx` | Copied and adapted | `src/components/MetricCard.tsx` |
| `components/paperclip/MobileBottomNav.tsx` | Copied and adapted | `src/components/MobileBottomNav.tsx` |
| `components/paperclip/SidebarCompanyMenu.tsx` | Copied and adapted | `src/components/SidebarCompanyMenu.tsx` |
| `components/paperclip/SidebarNavItem.tsx` | Copied and adapted | `src/components/SidebarNavItem.tsx` |
| `components/paperclip/SidebarSection.tsx` | Copied and adapted | `src/components/SidebarSection.tsx` |
| `components/paperclip/TaskList.tsx` | Copied and adapted | `src/components/TaskListColumns.tsx; src/components/IssueRow.tsx (viewport and row recipes)` |
| `components/paperclip/fonts/Inter-OFL.txt` | Copied unchanged | `Inter v4.1 LICENSE.txt (see font notice)` |
| `components/paperclip/fonts/InterVariable-Italic.woff2` | Copied unchanged | `public/fonts/InterVariable-Italic.woff2` |
| `components/paperclip/fonts/InterVariable.woff2` | Copied unchanged | `public/fonts/InterVariable.woff2` |
| `components/paperclip/fonts/NOTICE.md` | Copied unchanged | `public/fonts/NOTICE.md` |
| `components/paperclip/fonts/PaperMono-OFL.txt` | Copied unchanged | `public/fonts/PaperMono-OFL.txt` |
| `components/paperclip/fonts/PaperMono-Variable.woff2` | Copied unchanged | `public/fonts/PaperMono-Variable.woff2` |
| `components/paperclip/mobile-nav-scroll.ts` | Copied unchanged | `src/lib/mobile-nav-scroll.ts` |
| `components/paperclip/theme.css` | Copied and adapted | `src/index.css; src/motion-tokens.css (scoped tokens and base recipes)` |
| `components/paperclip/ui/badge.tsx` | Copied and adapted | `src/components/ui/badge.tsx` |
| `components/paperclip/ui/breadcrumb.tsx` | Copied and adapted | `src/components/ui/breadcrumb.tsx` |
| `components/paperclip/ui/button.tsx` | Copied and adapted | `src/components/ui/button.tsx` |
| `components/paperclip/ui/collapsible.tsx` | Copied and adapted | `src/components/ui/collapsible.tsx` |
| `components/paperclip/ui/card.tsx` | Copied and adapted | `src/components/ui/card.tsx` |
| `components/paperclip/ui/dialog.tsx` | Copied and adapted | `src/components/ui/dialog.tsx` |
| `components/paperclip/ui/dropdown-menu.tsx` | Copied and adapted | `src/components/ui/dropdown-menu.tsx` |
| `components/paperclip/ui/flyout-appearance.tsx` | Copied and adapted | `src/components/ui/flyout-appearance.tsx` |
| `components/paperclip/ui/input.tsx` | Copied and adapted | `src/components/ui/input.tsx` |
| `components/paperclip/ui/sheet.tsx` | Copied and adapted | `src/components/ui/sheet.tsx` |
| `components/paperclip/useMobileNavVisibility.ts` | Copied and adapted | `src/hooks/useMobileNavVisibility.ts` |
| `components/paperclip/utils.ts` | Copied and adapted | `src/lib/utils.ts` |

## Hermes Agent (hermes-agent)

Source: https://hub.docker.com/r/nousresearch/hermes-agent (Nous Research's official release image)

The install runs Hermes's official release image, `nousresearch/hermes-agent`, as its agent engine (ADR 0010), pinned by tag and digest in `docker-compose.install.yml`. gtmworks copies no Hermes code; the image is pulled unchanged at install time. Keep this notice while the install ships Hermes.

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
