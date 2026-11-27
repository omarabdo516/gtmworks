# The restore check of ../kanban-board.md, section 10 (#842). It runs inside the pinned Engine image, on an empty board
# of its own (HERMES_HOME in a temporary folder), and goes through the Kanban plugin's own routes
# (plugins/kanban/dashboard/plugin_api.py). A dry-run dispatcher tick says whether a Card would start. The install
# proof's proxy area runs it (#911) in the install's Engine (scripts/ci-install-check.sh). By hand, from the repository root:
#   docker run --rm -i --entrypoint /bin/sh "$(sed -n 's/^ *image: //p' scripts/engine-template.yml | head -n 1)" \
#     -c 'cd /opt/hermes && python -' < docs/engine-probes/kanban-board/restore.py
# It prints one line per Card and exits 1 when the Engine no longer does what lib/engine/board.mjs restoreCard counts on.
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
    if state == "done": kb.complete_task(conn, task, summary="Sent", force=True)
    return task

def startable(task):
    tick = kbd.dispatch_once(conn, dry_run=True, max_spawn=50)
    return task in [row[0] for row in tick.spawned] + list(tick.skipped_nonspawnable)

def patch(task, body):
    return client.patch(f"/tasks/{task}", json=body).status_code

def where(task):
    found = kb.get_task(conn, task); return (found.status, found.assignee)

failed = []
def expect(what, got, want):
    print(f"{'ok  ' if got == want else 'FAIL'} {what}: {got}")
    if got != want: failed.append(what)

# A Card with no Agent, `ready` out of the archive, is never started; a Card that is ready with its Agent is.
for state in ["running", "blocked", "review", "scheduled"]:
    task = card(state); patch(task, {"status": "archived"})
    expect(f"{state}: back to ready with its Agent starts", (patch(task, {"status": "ready"}), startable(task)), (200, True))
    task = card(state); patch(task, {"status": "archived"})
    patch(task, {"assignee": "", "status": "ready"})
    expect(f"{state}: ready with no Agent does not start", startable(task), False)
    expect(f"{state}: stopped, then its Agent back", (patch(task, {"status": "scheduled"}), patch(task, {"assignee": "alpha"}), where(task), startable(task)),
           (200, 200, ("scheduled", "alpha"), False))
    if state == "review":
        expect("review: the Agent's review_requested is still the latest", kb._latest_event(conn, task, "review_requested")["payload"],
               '{"summary": "Draft ready", "implementer": "alpha", "reviewer": null}')
    expect(f"{state}: Continue lets it go on", (patch(task, {"status": "ready"}), where(task)[0]), (200, "ready"))
# Why not the status it had: a person's block after the Agent's lands in triage, and a review asked again names no implementer.
task = card("blocked"); patch(task, {"status": "archived"}); patch(task, {"assignee": "", "status": "ready"})
expect("blocked: blocked again lands in triage", (patch(task, {"status": "blocked"}), where(task)[0]), (200, "triage"))
task = card("review"); patch(task, {"status": "archived"}); patch(task, {"assignee": "", "status": "ready"}); patch(task, {"status": "review"})
expect("review: review asked again names no implementer", kb._latest_event(conn, task, "review_requested")["payload"],
       '{"summary": null, "implementer": null, "reviewer": null}')
# A done Card: ready with no Agent, done again with its summary, its Agent back.
task = card("done"); patch(task, {"status": "archived"}); patch(task, {"assignee": "", "status": "ready"})
expect("done: done again with its summary, its Agent back", (client.patch(f"/tasks/{task}", json={"status": "done", "summary": "Sent"}).status_code,
       patch(task, {"assignee": "alpha"}), where(task)), (200, 200, ("done", "alpha")))
sys.exit(1 if failed else 0)
