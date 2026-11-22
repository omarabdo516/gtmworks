#!/bin/sh
# One patch to the pinned Engine (#621): a request that runs out of one subscription account's quota goes on, in the
# Owner's order, on the next account of the same kind the Owner left switched on, and the Engine says that it moved.
#
# The pinned Hermes v0.23.0 already does the moving itself: a usage-limit or billing failure marks the account in use
# exhausted and the same model call is sent again on the next available entry of the provider's credential pool
# (agent/agent_runtime_helpers.py recover_with_credential_pool, _rotate_and_swap; agent/turn_recovery.py), so no step
# the request already took (a tool call, a reply) is sent again. What it lacks, and this hook adds:
#
# - the Owner's order: the pool takes its entries by `priority`, which only `hermes auth priority` reorders, and on
#   Claude it puts every manually added entry before a seeded one on each load (credential_pool.py
#   _normalize_pool_priorities). An entry the Owner placed carries its place in its own row (`gtmworks_place`, kept by
#   the pool as row metadata, PooledCredential.extra) and the pool sorts by it first, then by priority as before;
# - an account switched off: the pool has no such state. A row marked `gtmworks_off` is never selected, by a new
#   request or by a rotation (_available_entries), and keeps its sign-in, so switching it on needs none;
# - one route to set both, PUT /api/credentials/pool/<provider>/order?profile=<name>, body
#   {"entries":[{"id":"<entry id>","off":false},...]} first to last; an entry it does not name loses its place and is on.
#   It writes the stored rows under the store's lock, and every other write of a row keeps the stored order and switch
#   (hermes_cli/auth.py _merge_pool_row_generation), so a pool loaded before a change cannot write the old one back;
# - what it moved: each rotation that swapped another account in appends one line, the provider and the two entry ids
#   with an id of its own and the time, to gtmworks/credential-switches.jsonl in the Engine's root home (every profile
#   borrows the root's accounts), the last 200 kept; GET /api/credentials/pool/switches lists the last 100. No token,
#   label or error text is written. An account found exhausted with nothing to move to writes nothing.
#
# The image stays the pinned official one; the container's own copy is patched before s6 starts any service, the same
# way scripts/engine-codex-accounts.sh runs. Each replacement is exact text and a text the pinned release does not hold
# fails this hook, which fails the container's start and the install, so a pin bump cannot silently drop it. Removed when
# the pin moves to an upstream release that orders and switches off pool entries and reports a rotation.
set -eu
/opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path
import sys

root = Path("/opt/hermes")
record = '''    def _rotate_and_swap(default_status: int, label: str) -> bool:
        """Rotate away from the failed credential; True when a new entry was swapped in."""
        swapped = _gtmworks_rotate_and_swap(default_status, label)
        if swapped and _gtmworks_before and _gtmworks_before != getattr(agent, "_credential_pool_entry_id", None):
            _gtmworks_record_switch(pool.provider, _gtmworks_before, getattr(agent, "_credential_pool_entry_id", None))
        return swapped

    # gtmworks patch (#621, scripts/engine-pool-order.sh): the account in use before the rotation, to say what moved.
    _gtmworks_before = credential_id or getattr(agent, "_credential_pool_entry_id", None)

    def _gtmworks_rotate_and_swap(default_status: int, label: str) -> bool:
        """Rotate away from the failed credential; True when a new entry was swapped in."""
'''
recorder = '''def _gtmworks_record_switch(provider, before, after) -> None:
    """gtmworks patch (#621, scripts/engine-pool-order.sh): one line per account the Engine moved a request to."""
    import fcntl, json, time, uuid
    from hermes_constants import get_default_hermes_root
    try:
        if not (isinstance(before, str) and isinstance(after, str) and before and after):
            return
        path = get_default_hermes_root() / "gtmworks" / "credential-switches.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"id": uuid.uuid4().hex, "provider": str(provider or ""), "from": before, "to": after,
                           "at": time.time()}) + "\\n"
        with open(path, "a+", encoding="utf-8") as log:
            fcntl.flock(log, fcntl.LOCK_EX)
            log.write(line)
            log.flush()
            if log.tell() > 128 * 1024:
                log.seek(0)
                kept = log.readlines()[-200:]
                log.seek(0)
                log.truncate()
                log.writelines(kept)
    except Exception:
        logger.debug("gtmworks: credential switch not recorded", exc_info=True)


def recover_with_credential_pool('''
routes = '''import fastapi as _gtmworks_fastapi


@router.put("/api/credentials/pool/{provider}/order")
async def gtmworks_order_credential_pool(provider: str, body: Dict[str, Any] = _gtmworks_fastapi.Body(...),
                                         profile: Optional[str] = None):
    """gtmworks patch (#621, scripts/engine-pool-order.sh): the Owner's order of a provider's accounts, and which are off."""
    from agent.credential_pool import load_pool
    from hermes_cli.auth import _auth_store_lock, _load_auth_store, _save_auth_store

    provider = (provider or "").strip().lower()
    listed = body.get("entries") if isinstance(body, dict) else None
    if (not isinstance(listed, list) or len(listed) > 64
            or not all(isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"]
                       and isinstance(e.get("off"), bool) for e in listed)
            or len({e["id"] for e in listed}) != len(listed)):
        raise HTTPException(status_code=400, detail="entries must list each pool entry id once, with off true or false")
    wanted = {e["id"]: (place, e["off"]) for place, e in enumerate(listed)}

    def _run():
        # Loading the pool first stores every row it seeds; then the rows are changed in the store itself, under its
        # lock. Every other write keeps what the store holds for these two keys (_merge_pool_row_generation below), so a
        # pool loaded before this change can never write an older order or switch back.
        load_pool(provider)
        with _auth_store_lock():
            store = _load_auth_store()
            rows = (store.get("credential_pool") or {}).get(provider)
            changed = False
            for row in rows if isinstance(rows, list) else []:
                if not isinstance(row, dict):
                    continue
                before = dict(row)
                row.pop("gtmworks_place", None)
                row.pop("gtmworks_off", None)
                if row.get("id") in wanted:
                    place, off = wanted[row["id"]]
                    row.update(gtmworks_place=place, gtmworks_off=off, priority=place)
                changed = changed or row != before
            if changed:
                _save_auth_store(store)
        ordered = load_pool(provider).entries()
        return {"ok": True, "provider": provider,
                "entries": [{"id": e.id, "off": (e.extra or {}).get("gtmworks_off") is True} for e in ordered]}

    return await config_scoped_to_thread(destructive_profile(profile, "PUT /api/credentials/pool/{provider}/order"), _run)


@router.get("/api/credentials/pool/switches")
async def gtmworks_credential_switches():
    """gtmworks patch (#621, scripts/engine-pool-order.sh): the last accounts the Engine moved requests to."""
    import json
    from hermes_constants import get_default_hermes_root

    def _run():
        path = get_default_hermes_root() / "gtmworks" / "credential-switches.jsonl"
        rows = []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()[-100:]
        except FileNotFoundError:
            lines = []
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict):
                rows.append({k: row.get(k) for k in ("id", "provider", "from", "to", "at")})
        return {"switches": rows}

    return await asyncio.to_thread(_run)


@router.delete("/api/credentials/pool/{provider}/{index}")
'''
merge = '''def _merge_pool_row_generation(entry, disk_entry, provider_id, **kwargs):
    """gtmworks patch (#621, scripts/engine-pool-order.sh): the stored order and switch win over any other write."""
    merged = _gtmworks_merge_pool_row_generation(entry, disk_entry, provider_id, **kwargs)
    if isinstance(disk_entry, dict):
        merged = {k: v for k, v in merged.items() if k not in ("gtmworks_place", "gtmworks_off")}
        merged.update({k: disk_entry[k] for k in ("gtmworks_place", "gtmworks_off") if k in disk_entry})
    return merged


def _gtmworks_merge_pool_row_generation(
'''
patches = [
    # Every write of a pool row (write_credential_pool, and a borrowing profile's _update_root_pool_rows) merges it with
    # the stored row here: the Owner's order and switch are taken from the stored row, so only the order route sets them.
    (root / "hermes_cli/auth.py",
     'def _merge_pool_row_generation(\n',
     merge),
    # The pool's order: a placed entry first, by its place, then the rest by priority as before.
    (root / "agent/credential_pool.py",
     '        self._entries = sorted(entries, key=lambda entry: entry.priority)\n',
     '        # gtmworks patch (#621, scripts/engine-pool-order.sh): the Owner\'s order first.\n'
     '        self._entries = sorted(entries, key=lambda entry: (0, entry.extra["gtmworks_place"], entry.priority)\n'
     '                               if isinstance((entry.extra or {}).get("gtmworks_place"), int) else (1, 0, entry.priority))\n'),
    # With the Owner's order in place the pool takes the first account available in it, whatever strategy is configured:
    # least_used, random and round_robin would pick past it.
    (root / "agent/credential_pool.py",
     '        self._strategy = get_pool_strategy(provider)\n',
     '        # gtmworks patch (#621, scripts/engine-pool-order.sh): the Owner\'s order picks the account.\n'
     '        self._strategy = STRATEGY_FILL_FIRST if any(isinstance((e.extra or {}).get("gtmworks_place"), int)\n'
     '                                                    for e in self._entries) else get_pool_strategy(provider)\n'),
    # A switched-off account is never available, for a new request or a rotation.
    (root / "agent/credential_pool.py",
     '        for entry in self._entries:\n            # Borrowed credentials persist as metadata-only references and are\n',
     '        for entry in self._entries:\n'
     '            if (entry.extra or {}).get("gtmworks_off") is True:\n'
     '                continue  # gtmworks patch (#621, scripts/engine-pool-order.sh): switched off by the Owner\n'
     '            # Borrowed credentials persist as metadata-only references and are\n'),
    # Each rotation that swapped another account in is recorded, by the two entry ids.
    (root / "agent/agent_runtime_helpers.py",
     'def recover_with_credential_pool(',
     recorder),
    (root / "agent/agent_runtime_helpers.py",
     '    def _rotate_and_swap(default_status: int, label: str) -> bool:\n'
     '        """Rotate away from the failed credential; True when a new entry was swapped in."""\n',
     record),
    # The two routes, just above the pool's removal route.
    (root / "hermes_cli/web_routers/ops.py",
     '@router.delete("/api/credentials/pool/{provider}/{index}")\n',
     routes),
]
for path, old, new in patches:
    text = path.read_text(encoding="utf-8")
    # A restarted container keeps its patched copy and runs this hook again: a text already patched stays as it is.
    if text.count(new) == 1:
        continue
    if text.count(old) != 1:
        sys.exit("engine-pool-order: the pinned Engine's " + str(path) +
                 " does not hold the expected text once; refusing to start without the account order patch")
    path.write_text(text.replace(old, new), encoding="utf-8")
PY
