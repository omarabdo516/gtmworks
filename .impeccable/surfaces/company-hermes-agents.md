# Company Agents: Hermes assignments (#242)

Scope: extend `/c/[slug]/agents` for members reading their Company's agents and the Company's Owners attaching connected profiles. The existing legacy grant panel remains below it for Company owners.

## Direction contract

THESIS: make the Company's named agents and default clear before presenting attachment controls. This is an extension of the existing Agents surface, governed by `DESIGN.md` and the approved conversation prototype.

OWN-WORLD: inherit the Paperclip neutral panel, detail rows, generated faces, field and button styles, logical layout and device theme. No new visual identity, CSS tokens or raster assets.

STORY: members read names, specialities and the default. An Owner chooses an existing connected profile, supplies its company name and speciality, and optionally makes it default. A server refusal exposes the explicit per-profile memory-sharing confirmation. Removing a default with other agents requires choosing its successor.

FIRST VIEWPORT: one connected-agents panel above legacy grants, with agent details first and Owner controls below. Controls wrap on mobile. English and Arabic use the existing shell direction and content keeps its own direction.

FORM: inherit the existing surface; no concept tournament for this narrow extension. seed: none (unavailable). The optional flow-confirmation prompt received no answer; the issue and incumbent controls supply the flow.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Validation boundary: local browser, Supabase and production-build execution are prohibited by the implementation request. Source review and the mechanical detector can run; rendered English/Arabic and responsive evidence remain for CI. No screen in the existing `tests/visual-screens.mjs` list changes: its Agents entry is `/settings/agents`, whereas this extension is `/agents`.
