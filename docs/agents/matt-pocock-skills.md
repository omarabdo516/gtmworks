# Matt Pocock's skills in this repo

Matt Pocock's engineering skills (https://github.com/mattpocock/skills, MIT) are copied into `.claude/skills/`, one
folder per skill, at the commit pinned in `scripts/vendor-matt-skills.sh` (#473). Claude Code reads `.claude/skills/`
from the clone, so every session lists them: local, cloud, and cloud sessions with several repositories. A plugin or
marketplace named in `.claude/settings.json` loads in local sessions only, so the repo settings name none; a person who
also turned the `mattpocock-skills` plugin on for their own account sees each skill twice and can turn the plugin off.

The skills read this repo's setup from `docs/agents/` (issue tracker, triage labels, domain docs, code review rules),
pointed at by the Agent skills section of `CLAUDE.md`.

## Which skills

Every skill the upstream plugin ships (its `.claude-plugin/plugin.json`), less two:

- `setup-matt-pocock-skills`: it writes `docs/agents/`, which this repo already configured by hand.
- `teach`: it turns the working folder into a teaching workspace.

The list is in `scripts/vendor-matt-skills.sh`. `code-review`, `prototype` and `research` share a name with a Claude
Code built-in; which one a bare `/code-review` reaches is the harness's choice, and the skill text is the same either way.

## Refreshing the copy

The copy does not update itself. To move to a newer upstream commit:

1. Set `pin=` in `scripts/vendor-matt-skills.sh` to the new commit, and add or drop names in its list if upstream did.
2. Run `bash scripts/vendor-matt-skills.sh`. It fetches that commit, checks every listed skill is there, and replaces
   each listed folder in `.claude/skills/` with upstream's; folders it does not list are left alone.
3. Put the same commit in the Matt Pocock section of `THIRD_PARTY_NOTICES.md`, and its licence text if it changed.
4. Read the diff (a skill may now expect something `docs/agents/` lacks), run `npm test`, and open a pull request.

Change a skill only upstream, or by dropping it from the list: the next refresh overwrites a local edit.
