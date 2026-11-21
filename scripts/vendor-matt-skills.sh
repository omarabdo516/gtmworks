#!/usr/bin/env bash
# Copies Matt Pocock's skills (https://github.com/mattpocock/skills, MIT) into .claude/skills/ (#473). A plugin named in
# .claude/settings.json loads in local Claude Code sessions only; .claude/skills/ is part of the clone, so every session,
# local or cloud, lists these skills. Refresh by hand: set pin= to the new upstream commit, run
# `bash scripts/vendor-matt-skills.sh`, put the same commit in THIRD_PARTY_NOTICES.md, and commit
# (docs/agents/matt-pocock-skills.md).
set -euo pipefail
cd "$(dirname "$0")/.."

pin=abeeaf95660ba9e8b7c753eb38f441ca707a8823
# The skills the upstream plugin ships (its .claude-plugin/plugin.json), less two that do not fit this repo:
# setup-matt-pocock-skills rewrites docs/agents/, which this repo configured by hand; teach turns the working folder
# into a teaching workspace.
skills='
  engineering/ask-matt
  engineering/code-review
  engineering/codebase-design
  engineering/diagnosing-bugs
  engineering/domain-modeling
  engineering/grill-with-docs
  engineering/implement
  engineering/implement-spec
  engineering/improve-codebase-architecture
  engineering/pr
  engineering/prototype
  engineering/research
  engineering/retro
  engineering/tdd
  engineering/to-spec
  engineering/to-tickets
  engineering/triage
  engineering/wayfinder
  engineering/wizard
  productivity/grill-me
  productivity/grilling
  productivity/handoff
  productivity/to-questionnaire
  productivity/wait-what
  productivity/writing-for-agents
'
commit=${1:-$pin}
source=${MATT_SKILLS_SOURCE:-https://github.com/mattpocock/skills.git}
target=${MATT_SKILLS_TARGET:-.claude/skills}
list=${MATT_SKILLS_LIST:-$skills}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work/upstream"
git -C "$work/upstream" fetch -q --depth 1 "$source" "$commit"
git -C "$work/upstream" checkout -q FETCH_HEAD

# Every listed skill must be there before anything in the target changes.
for skill in $list; do
  [[ -f "$work/upstream/skills/$skill/SKILL.md" ]] || { echo "vendor-matt-skills: skills/$skill/SKILL.md is not at $commit" >&2; exit 1; }
done
mkdir -p "$target"
for skill in $list; do
  name=${skill##*/}
  rm -rf "${target:?}/$name"
  cp -R "$work/upstream/skills/$skill" "$target/$name"
done
echo "vendor-matt-skills: $(wc -w <<< "$list") skills from $commit in $target"
