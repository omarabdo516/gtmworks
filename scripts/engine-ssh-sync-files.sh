#!/bin/sh
# One patch to the pinned Engine (#393): terminal.ssh_sync_files turns the ssh backend's file sync off.
#
# The pinned Hermes v0.23.0 builds every ssh environment with sync_files=True (tools/terminal_tool_backends.py,
# _build_ssh_env), so a Run copies the profile's credential files, Skills and caches into the sandbox and a session
# teardown copies what the Agent changed there back onto the Engine's disk (probe:
# docs/engine-probes/work-sandbox-ssh.md, section 9). SSHEnvironment already has the switch (sync_files=False: no
# FileSyncManager, so nothing is copied in and nothing back), but the pinned release has no config key for it. This hook
# adds terminal.ssh_sync_files exactly as the upstream change does, and gtmworks sets it false in
# scripts/engine-managed.yml. The image stays the pinned official one; the container's own copy is patched before s6
# starts any service, the same way scripts/engine-listener-address.sh runs.
#
# Each replacement is exact text and a text the pinned release does not hold fails this hook, which fails the container's
# start and the install, so a pin bump cannot silently drop the switch. Removed when the pin moves to an upstream release
# that has the key.
set -eu
/opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path
import sys

root = Path("/opt/hermes")
patches = [
    # The gateway bridges terminal.ssh_sync_files to TERMINAL_SSH_SYNC_FILES, beside the other ssh keys.
    (root / "gateway/run.py",
     '        "ssh_key": "TERMINAL_SSH_KEY",',
     '        "ssh_key": "TERMINAL_SSH_KEY",\n        "ssh_sync_files": "TERMINAL_SSH_SYNC_FILES",'),
    # The config-to-env map: the per-profile terminal scope and the CLI bridge both use it.
    (root / "hermes_cli/config.py",
     '            "daytona_image", "vercel_runtime", "vercel_image", "ssh_host", "ssh_user", "ssh_port", "ssh_key",',
     '            "daytona_image", "vercel_runtime", "vercel_image", "ssh_host", "ssh_user", "ssh_port", "ssh_key", "ssh_sync_files",'),
    # The CLI's own map of the same keys.
    (root / "hermes_cli/cli_config_load.py",
     '        "ssh_host", "ssh_user", "ssh_port", "ssh_key", "container_cpu", "container_memory",',
     '        "ssh_host", "ssh_user", "ssh_port", "ssh_key", "ssh_sync_files", "container_cpu", "container_memory",'),
    # The code default, so a profile's terminal policy is total: an omitted key never falls back to the launch process.
    (root / "tools/terminal_scope.py",
     '    "cwd": ".", "ssh_host": "", "ssh_user": "", "ssh_port": 22, "ssh_key": "",',
     '    "cwd": ".", "ssh_host": "", "ssh_user": "", "ssh_port": 22, "ssh_key": "", "ssh_sync_files": True,'),
    # The terminal config carries it from the env var, as it carries the other ssh keys.
    (root / "tools/terminal_tool.py",
     '        "ssh_key": _tenv("TERMINAL_SSH_KEY", ""),',
     '        "ssh_key": _tenv("TERMINAL_SSH_KEY", ""),\n'
     '        "ssh_sync_files": _tenv_bool("TERMINAL_SSH_SYNC_FILES", "true"),'),
    # ssh_config carries it beside the other ssh keys.
    (root / "tools/terminal_tool_backends.py",
     '_SSH_KEYS = (("host", "ssh_host", ""), ("user", "ssh_user", ""), ("port", "ssh_port", 22),\n'
     '             ("key", "ssh_key", ""), ("persistent", "ssh_persistent", True))',
     '_SSH_KEYS = (("host", "ssh_host", ""), ("user", "ssh_user", ""), ("port", "ssh_port", 22),\n'
     '             ("key", "ssh_key", ""), ("persistent", "ssh_persistent", True),\n'
     '             ("sync_files", "ssh_sync_files", True))'),
    # The ssh backend builder passes it to the environment.
    (root / "tools/terminal_tool_backends.py",
     '    return _SSHEnvironment(host=ssh_config["host"], user=ssh_config["user"], port=ssh_config.get("port", 22),\n'
     '                           key_path=ssh_config.get("key", ""), cwd=cwd, timeout=timeout, probe_only=probe_only,\n'
     '                           persistent=ssh_config.get("persistent", True))',
     '    return _SSHEnvironment(host=ssh_config["host"], user=ssh_config["user"], port=ssh_config.get("port", 22),\n'
     '                           key_path=ssh_config.get("key", ""), cwd=cwd, timeout=timeout, probe_only=probe_only,\n'
     '                           persistent=ssh_config.get("persistent", True),\n'
     '                           sync_files=ssh_config.get("sync_files", True))'),
]
for path, old, new in patches:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit("engine-ssh-sync-files: the pinned Engine's " + str(path) +
                 " does not hold the expected text once; refusing to start without the file-sync switch")
    path.write_text(text.replace(old, new), encoding="utf-8")
PY
