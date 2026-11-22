#!/bin/sh
# One patch to the pinned Engine (#618): a ChatGPT sign-in from Settings adds its account beside the ones the Company
# already holds, and never overwrites one.
#
# The pinned Hermes v0.23.0 saves every dashboard ChatGPT sign-in (POST /api/providers/oauth/openai-codex/start, the
# device-code worker in hermes_cli/web_routers/oauth.py, _codex_full_login_worker) through the one singleton
# `_save_codex_tokens`, so a second account replaces the first. Its own command line already keeps each account apart:
# `hermes auth add openai-codex` adds an independent `manual:device_code` pool entry per account
# (hermes_cli/auth_commands.py _add_credential, #39236 upstream). This hook gives the dashboard's sign-in the same rule:
#
# - no ChatGPT account yet, or the account already held as the singleton: the singleton save, as before, after lifting
#   the suppression a removal from the pool left on it (DELETE /api/credentials/pool, ops.py 438-488), so it is listed;
# - the account already held as an added entry: that entry's tokens are renewed in place, so it keeps its id (the id
#   gtmworks names the Provider by) and no second login of one account sits beside it (one token family, #47096);
# - any other account: a new `manual:device_code` entry, as `hermes auth add openai-codex` makes it.
#
# Removing one such account from the pool then removes that account only (agent/credential_sources.py
# _remove_codex_device_code, which otherwise clears the singleton for any `*:device_code` row).
#
# The image stays the pinned official one; the container's own copy is patched before s6 starts any service, the same
# way scripts/engine-ssh-sync-files.sh runs. Each replacement is exact text and a text the pinned release does not hold
# fails this hook, which fails the container's start and the install, so a pin bump cannot silently drop it. Removed when
# the pin moves to an upstream release whose dashboard sign-in adds an account.
set -eu
/opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path
import sys

root = Path("/opt/hermes")
helper = '''def _gtmworks_save_codex_login(tokens: dict[str, str]) -> None:
    """gtmworks patch (#618, scripts/engine-codex-accounts.sh): a second ChatGPT account is added, never overwritten."""
    import uuid
    from dataclasses import replace
    from agent.credential_pool import (
        _CLEAR_STATUS, AUTH_TYPE_OAUTH, SOURCE_MANUAL_DEVICE_CODE, PooledCredential, _codex_principal_identity,
        label_from_token, load_pool)
    from hermes_cli.auth import DEFAULT_CODEX_BASE_URL, _save_codex_tokens, _utc_now_z

    pool = load_pool("openai-codex")
    entries = pool.entries()
    identity = _codex_principal_identity(tokens.get("access_token"))
    same = [e for e in entries if identity is not None and _codex_principal_identity(e.access_token) == identity]
    if not entries or any(e.source == "device_code" for e in same):
        # A sign-in is the re-engagement the pool's own add route reads it as: a singleton removed earlier from the
        # pool was suppressed, and would otherwise never be listed again.
        from hermes_cli.auth import unsuppress_credential_source
        unsuppress_credential_source("openai-codex", "device_code")
        _save_codex_tokens(tokens)
        return
    if same:
        held = same[0]
        renewed = replace(held, access_token=tokens["access_token"],
                          refresh_token=tokens.get("refresh_token") or held.refresh_token,
                          last_refresh=_utc_now_z(), **_CLEAR_STATUS)
        pool._replace_entry(held, renewed)
        pool._persist(status_cleared_ids=[held.id])
        return
    pool.add_entry(PooledCredential(
        provider="openai-codex", id=uuid.uuid4().hex[:6],
        label=label_from_token(tokens["access_token"], f"openai-codex-oauth-{len(entries) + 1}"),
        auth_type=AUTH_TYPE_OAUTH, priority=0, source=SOURCE_MANUAL_DEVICE_CODE,
        access_token=tokens["access_token"], refresh_token=tokens.get("refresh_token"),
        base_url=DEFAULT_CODEX_BASE_URL, last_refresh=_utc_now_z()))


def _codex_full_login_worker(session_id: str) -> None:'''
removal = '''def _remove_codex_device_code(provider: str, removed) -> RemovalResult:
    """gtmworks patch (#618, scripts/engine-codex-accounts.sh): an independent account leaves alone."""
    from agent.credential_pool import _codex_entry_tracks_singleton
    from hermes_cli.auth import _load_auth_store
    singleton = ((_load_auth_store().get("providers") or {}).get(provider) or {}).get("tokens") or {}
    if removed.source != "device_code" and not _codex_entry_tracks_singleton(removed, singleton):
        return RemovalResult(suppress=False)
    return _gtmworks_remove_codex_singleton(provider, removed)


def _gtmworks_remove_codex_singleton(provider: str, removed) -> RemovalResult:'''
patches = [
    # Removing one ChatGPT account from the pool (DELETE /api/credentials/pool, ops.py 438-488) runs this step, which in
    # the pinned release clears the singleton and suppresses its source for every `*:device_code` row, so removing a
    # second account would take the first's sign-in with it. A `manual:device_code` row that does not track the singleton
    # is an independent account (credential_pool.py _codex_entry_tracks_singleton): it has nothing outside the pool to
    # clean and is not re-seeded, so it leaves alone; the singleton's own row, or its legacy alias, still clears it.
    (root / "agent/credential_sources.py",
     'def _remove_codex_device_code(provider: str, removed) -> RemovalResult:',
     removal),
    # The helper, just above the worker that calls it.
    (root / "hermes_cli/web_routers/oauth.py",
     'def _codex_full_login_worker(session_id: str) -> None:',
     helper),
    # The worker's save, still inside the profile scope and the session lock it ran under.
    (root / "hermes_cli/web_routers/oauth.py",
     '            _save_codex_tokens(tokens)\n            sess["status"] = "approved"',
     '            _gtmworks_save_codex_login(tokens)\n            sess["status"] = "approved"'),
]
for path, old, new in patches:
    text = path.read_text(encoding="utf-8")
    # A restarted container keeps its patched copy and runs this hook again: a text already patched stays as it is.
    if text.count(new) == 1:
        continue
    if text.count(old) != 1:
        sys.exit("engine-codex-accounts: the pinned Engine's " + str(path) +
                 " does not hold the expected text once; refusing to start without the ChatGPT accounts patch")
    path.write_text(text.replace(old, new), encoding="utf-8")
PY
