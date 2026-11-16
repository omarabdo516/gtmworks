# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# Claude Code only, scoped to this repo. Panel roles hold one entry because Claude Code has no second vendor; the other-vendor review is Codex on GitHub.
# budget: medium
feature, refactoring: claude-opus-5-5-medium
bug-fix: claude-opus-5-5-medium
perf-issue: claude-opus-5-5-medium
hillclimb: claude-opus-5-5-medium
judgment and prose: claude-opus-5-5-high
hardest tasks: claude-opus-5-5-high
how explorer: claude-sonnet-5-5-medium
how explainer: claude-sonnet-5-5-medium
why investigators: claude-sonnet-5-5-medium
why synthesizer: claude-opus-5-5-medium
reflect tooling: claude-sonnet-5-5-medium
reflect judgment, divergent, synthesizer: claude-opus-5-5-medium
arena runners: claude-opus-5-5-medium
arena cross-judge pool: claude-opus-5-5-medium
swarm workers: claude-opus-5-5-medium
architect runners: claude-opus-5-5-medium
interrogate reviewers: claude-opus-5-5-high
