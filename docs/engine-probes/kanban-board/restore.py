# The restore probe of ../kanban-board.md, section 10 (#842). Runs inside the pinned Engine image, on an empty board of
# its own, through the Kanban plugin's own routes (plugins/kanban/dashboard/plugin_api.py) with a dry-run dispatcher
# tick for "would it start". Run from the repository root:
#   docker run --rm -v "$PWD/docs/engine-probes/kanban-board:/p" --entrypoint /bin/sh \
#     "$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)" -c 'cd /opt/hermes && python /p/restore.py'
import importlib.util, os, sys, tempfile
os.environ["HERMES_HOME"] = tempfile.mkdtemp()
from fastapi import FastAPI
from fastapi.testclient import TestClient
spec = importlib.util.spec_from_file_location("kanban_plugin", "/opt/hermes/plugins/kanban/dashboard/plugin_api.py")
plugin = importlib.util.module_from_spec(spec); sys.modules["kanban_plugin"] = plugin; spec.loader.exec_module(plugin)
app = FastAPI(); app.include_router(plugin.router); client = TestClient(app)
from hermes_cli import kanban_db as kb, kanban_db_dispatch as kbd, kanban_db_connect as kbc
conn = kbc.connect()

def card(state):
    """A Card on `alpha` left by its worker in `state`, as the worker's own tools leave it."""
    task = client.post("/tasks", json={"title": state, "assignee": "alpha"}).json()["task"]["id"]
    kb.claim_task(conn, task)
    run = kb.get_task(conn, task).current_run_id
    if state == "blocked": kb.block_task(conn, task, reason="Which city?", expected_run_id=run)
    if state == "review": kb.request_review(conn, task, summary="Draft ready", expected_run_id=run)
    if state == "scheduled": kb.schedule_task(conn, task, reason="later", expected_run_id=run)
    return task

def startable(task):
    tick = kbd.dispatch_once(conn, dry_run=True, max_spawn=50)
    return task in [row[0] for row in tick.spawned] + list(tick.skipped_nonspawnable)

def patch(task, body):
    return client.patch(f"/tasks/{task}", json=body).status_code

def where(task):
    found = kb.get_task(conn, task); return f"{found.status} on {found.assignee}"

for state in ["running", "blocked", "review", "scheduled"]:
    for way in ["ready", "unassigned", "stopped"]:
        task = card(state); patch(task, {"status": "archived"})
        if way == "ready":
            steps = [patch(task, {"status": "ready"})]
        else:
            back = "scheduled" if way == "stopped" or state == "running" else state
            steps = [patch(task, {"assignee": "", "status": "ready"}), f"startable={startable(task)}",
                     patch(task, {"status": back}), patch(task, {"assignee": "alpha"})]
        print(f"{state:9} via {way:10} {steps} -> {where(task)}, startable={startable(task)}")
        if state == "review" and way != "ready":
            print("          review_requested:", kb._latest_event(conn, task, "review_requested")["payload"])
