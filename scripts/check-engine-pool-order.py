"""The account order patch on the pinned Engine (#621, scripts/engine-pool-order.sh), in a throwaway container of it.

Run by scripts/ci-install-check.sh, once per step with the step's HERMES_HOME: `root` on the Engine's root home, then
`borrowed` on an Agent's profile home under it, then `recorded` on the root again. Tokens are unsigned test JWTs and the
model call is never made: the Engine's own recovery step (recover_with_credential_pool) is given a usage-limit failure
as its classifier reports one, so nothing reaches OpenAI.
"""
import asyncio
import base64
import json
import sys
from types import SimpleNamespace

from agent.agent_runtime_helpers import recover_with_credential_pool
from agent.credential_pool import AUTH_TYPE_OAUTH, SOURCE_MANUAL_DEVICE_CODE, PooledCredential, load_pool
from agent.error_classifier import FailoverReason
from hermes_cli.auth import DEFAULT_CODEX_BASE_URL, _load_auth_store
from hermes_cli.web_routers import ops

LIMIT = {"reason": "usage_limit_reached", "message": "You have hit your usage limit"}


def order(entries):
    return asyncio.run(ops.gtmworks_order_credential_pool("openai-codex", {"entries": entries}, "default"))


def switches():
    return asyncio.run(ops.gtmworks_credential_switches())["switches"]


def ids():
    return [e.id for e in load_pool("openai-codex").entries()]


def running_on(pool, entry):
    """An Agent mid-request on `entry`, as the recovery step reads one; a swap rebinds it as _swap_credential does."""
    agent = SimpleNamespace(_credential_pool=pool, provider="openai-codex", base_url=DEFAULT_CODEX_BASE_URL, model="gpt-5.5",
                            _credential_pool_entry_id=entry.id, api_key=entry.access_token, _credential_pool_revert_id=None)

    def swap(chosen):
        agent._credential_pool_entry_id, agent.api_key = chosen.id, chosen.access_token
        agent.swaps.append(chosen.id)
        return True
    agent.swaps, agent._swap_credential = [], swap
    return agent


def exhaust(agent):
    return recover_with_credential_pool(agent, status_code=429, has_retried_429=True,
                                        classified_reason=FailoverReason.rate_limit, error_context=LIMIT)[0]


def root():
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    jwt = lambda who: part({"alg": "none"}) + "." + part({"sub": who, "exp": 4102444800,
                                                          "https://api.openai.com/auth": {"chatgpt_account_id": who}}) + ".t"
    pool = load_pool("openai-codex")
    for n, who in enumerate(["aaaaaa", "bbbbbb", "cccccc"]):
        pool.add_entry(PooledCredential(provider="openai-codex", id=who, label=who, auth_type=AUTH_TYPE_OAUTH, priority=n,
                                        source=SOURCE_MANUAL_DEVICE_CODE, access_token=jwt(who), refresh_token="r",
                                        base_url=DEFAULT_CODEX_BASE_URL))
    assert ids() == ["aaaaaa", "bbbbbb", "cccccc"], ids()
    # The Owner's order: c first, a switched off, b last. The pool lists and selects in that order.
    put = order([{"id": "cccccc", "off": False}, {"id": "aaaaaa", "off": True}, {"id": "bbbbbb", "off": False}])
    assert put["entries"] == [{"id": "cccccc", "off": False}, {"id": "aaaaaa", "off": True}, {"id": "bbbbbb", "off": False}], put
    assert ids() == ["cccccc", "aaaaaa", "bbbbbb"], ids()
    pool = load_pool("openai-codex")
    agent = running_on(pool, pool.select())
    assert agent._credential_pool_entry_id == "cccccc", agent._credential_pool_entry_id
    # c runs out: the same request goes on on b, the next account switched on, and the move is recorded once.
    assert exhaust(agent) is True and agent.swaps == ["bbbbbb"], agent.swaps
    listed = switches()
    assert [(s["provider"], s["from"], s["to"]) for s in listed] == [("openai-codex", "cccccc", "bbbbbb")], listed
    assert len(listed[0]["id"]) == 32 and isinstance(listed[0]["at"], float) and set(listed[0]) == {"id", "provider", "from", "to", "at"}
    status = {e["id"]: e["last_status"] for p in asyncio.run(ops.list_credential_pool(None))["providers"] for e in p["entries"]}
    assert status["cccccc"] == "exhausted" and status["bbbbbb"] != "exhausted" and status["aaaaaa"] != "exhausted", status
    # b runs out too: a is off, so nothing is left to move to, and nothing is recorded.
    assert exhaust(agent) is False and agent.swaps == ["bbbbbb"], agent.swaps
    assert len(switches()) == 1 and load_pool("openai-codex").select() is None
    # An order that no longer names a: its place and switch leave its stored row, and it is on again.
    order([{"id": "bbbbbb", "off": False}])
    rows = {r["id"]: r for r in _load_auth_store()["credential_pool"]["openai-codex"]}
    assert "gtmworks_off" not in rows["aaaaaa"] and "gtmworks_place" not in rows["aaaaaa"] and rows["bbbbbb"]["gtmworks_place"] == 0, rows
    assert load_pool("openai-codex").select().id == "aaaaaa"
    for bad in ({"entries": "x"}, {"entries": [{"id": "a"}]}, {"entries": [{"id": "a", "off": False}, {"id": "a", "off": True}]}):
        try:
            asyncio.run(ops.gtmworks_order_credential_pool("openai-codex", bad, "default"))
        except ops.HTTPException as refused:
            assert refused.status_code == 400
        else:
            sys.exit("the order route took " + repr(bad))
    # For the Agent's profile: every account usable again (`hermes auth reset`'s own step), b first, a off, then c.
    load_pool("openai-codex").reset_statuses()
    order([{"id": "bbbbbb", "off": False}, {"id": "aaaaaa", "off": True}, {"id": "cccccc", "off": False}])


def borrowed():
    # An Agent's profile holds no account of its own and borrows the root's, in the root's order and with its switch.
    pool = load_pool("openai-codex")
    assert [e.id for e in pool.entries()] == ["bbbbbb", "aaaaaa", "cccccc"], [e.id for e in pool.entries()]
    agent = running_on(pool, pool.select())
    assert agent._credential_pool_entry_id == "bbbbbb", agent._credential_pool_entry_id
    assert exhaust(agent) is True and agent.swaps == ["cccccc"], agent.swaps


def recorded():
    # The profile's move is in the root's record, after the root's own; the profile made no copy of the accounts.
    assert [(s["from"], s["to"]) for s in switches()] == [("cccccc", "bbbbbb"), ("bbbbbb", "cccccc")], switches()


{"root": root, "borrowed": borrowed, "recorded": recorded}[sys.argv[1]]()
print("engine pool order " + sys.argv[1] + ": ok")
