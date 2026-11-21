"""The fake model provider every probe's Run talks to.

It is not part of the product and holds no key: it answers each chat completion with the tool
calls the probe script asks for, then a short final answer. Every request it was sent is kept,
so a probe can show what a tool actually did with a file the Agent named (the vision probe's
bytes, for one).
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# plan name -> {"calls": [{"name": ..., "arguments": {...}}, ...], "answer": "..."}
plans: dict[str, dict] = {}
# Every request, in order: {"plan": name, "tools": [names], "messages": [...], "reply": {...}}
log: list[dict] = []


def _plan_of(messages) -> str | None:
    """The probe's name rides in the Run's input as its own line, `PROBE <name>`."""
    # Newest first: a Run that continues an Engine session carries the earlier turns too.
    for message in reversed(messages):
        content = message.get("content")
        if message.get("role") != "user" or not isinstance(content, str):
            continue
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("PROBE "):
                return line[6:].strip()
    return None


def _tool_calls(messages) -> int:
    return sum(1 for message in messages if message.get("role") == "tool")


def answer(body: dict) -> dict:
    messages = body.get("messages") or []
    name = _plan_of(messages)
    plan = plans.get(name or "", {"calls": [], "answer": "no plan"})
    calls = plan.get("calls") or []
    done = _tool_calls(messages)
    reply = {"role": "assistant", "content": None}
    finish = "stop"
    if done < len(calls):
        call = calls[done]
        reply["tool_calls"] = [{
            "id": f"call_{name}_{done}",
            "type": "function",
            "function": {"name": call["name"], "arguments": json.dumps(call.get("arguments") or {})},
        }]
        finish = "tool_calls"
    else:
        reply["content"] = plan.get("answer") or "done"
    log.append({"plan": name, "tools": [t["function"]["name"] for t in body.get("tools") or []],
                "messages": messages, "reply": reply})
    return {**reply, "finish": finish}


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):  # quiet
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if not self.path.endswith("/chat/completions"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        reply = answer(body)
        model = body.get("model")
        usage = {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28}
        if not body.get("stream"):
            payload = {"id": "fake", "object": "chat.completion", "created": 0, "model": model,
                       "choices": [{"index": 0, "message": {k: v for k, v in reply.items() if k != "finish"},
                                    "finish_reason": reply["finish"]}], "usage": usage}
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def chunk(choices, extra=None):
            data = json.dumps({"id": "fake", "object": "chat.completion.chunk", "created": 0,
                               "model": model, "choices": choices, **(extra or {})})
            self.wfile.write(f"data: {data}\n\n".encode())

        message = {k: v for k, v in reply.items() if k != "finish"}
        if reply["finish"] == "tool_calls":
            message["tool_calls"] = [{**c, "index": i} for i, c in enumerate(reply["tool_calls"])]
            message["content"] = None
        chunk([{"index": 0, "delta": message, "finish_reason": None}])
        chunk([{"index": 0, "delta": {}, "finish_reason": reply["finish"]}])
        chunk([], {"usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def start(port: int = 8080) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
