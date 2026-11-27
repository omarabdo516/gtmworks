#!/bin/sh
# gtmworks's theme as the default of the Engine's own dashboard (#872, spec #866), set where the Engine's own config names
# no dashboard theme. The theme itself (scripts/engine-dashboard-theme.yaml) is mounted where Hermes reads a user theme;
# this hook only chooses it. It runs before s6 starts any service, at every start, so a new Company's Engine and one
# brought up by `gtmworks update` both get it, and after Hermes's own setup hook has seeded the config. A theme the Owner
# picks in the dashboard writes dashboard.theme to the same config and is kept: the hook never sets a theme over one.
# Hermes's own `config set` writes the key, as the Engine's user, keeping the rest of the file as it is.
set -eu
# A cont-init hook runs with no HOME, which Hermes's own launcher reads: the Engine user's home is its data folder.
export HERMES_HOME=/opt/data HOME=/opt/data
python=/opt/hermes/.venv/bin/python
chosen=$("$python" - <<'PY'
from hermes_cli.config import read_user_config_raw
dashboard = read_user_config_raw().get("dashboard")
theme = dashboard.get("theme") if isinstance(dashboard, dict) else None
print(theme if isinstance(theme, str) else "")
PY
)
if [ -z "$chosen" ]; then
  /command/s6-setuidgid hermes /opt/hermes/.venv/bin/hermes config set dashboard.theme gtmworks
fi
