The hand-run probe of `../kanban-board.md`: `fake-model.mjs` listens on 18080 and asks `plan.mjs` (re-read on every
request) what to answer; the Engine ran with `--network host`, its dashboard on 127.0.0.1:19119 and its Run API on
127.0.0.1:18642, with `approvals.single_query_mode: approve` mounted at `/etc/hermes/config.yaml`.

`restore.py` is section 10's check (#842): it runs inside the pinned image on an empty board of its own, by hand or in the install proof's proxy area (#911), and its first lines say how.
