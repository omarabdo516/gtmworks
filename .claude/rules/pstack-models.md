# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# Claude Code only, scoped to this repo. Panel roles hold one entry because Claude Code has no second vendor; the other-vendor review is Codex on GitHub.
# budget: large (xhigh)
feature, refactoring: claude-opus-5-5-xhigh
bug-fix: claude-opus-5-5-xhigh
perf-issue: claude-opus-5-5-xhigh
hillclimb: claude-opus-5-5-xhigh
judgment and prose: claude-opus-5-5-xhigh
hardest tasks: claude-opus-5-5-xhigh
how explorer: claude-opus-5-5-xhigh
how explainer: claude-opus-5-5-xhigh
why investigators: claude-opus-5-5-xhigh
why synthesizer: claude-opus-5-5-xhigh
reflect tooling: claude-opus-5-5-xhigh
reflect judgment, divergent, synthesizer: claude-opus-5-5-xhigh
arena runners: claude-opus-5-5-xhigh
arena cross-judge pool: claude-opus-5-5-xhigh
swarm workers: claude-opus-5-5-xhigh
architect runners: claude-opus-5-5-xhigh
interrogate reviewers: claude-opus-5-5-xhigh
