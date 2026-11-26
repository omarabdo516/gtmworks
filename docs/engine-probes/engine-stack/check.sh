#!/bin/sh
# The check of #823: the stack stands up, answers on both listeners, holds a slow Run open, and leaves nothing behind
# after a clean end or after an interrupt halfway.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
left() { { docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; } | grep -c "^probe-$1-" || true; }

sh "$HERE/stack.sh" run stack-check node "$HERE/check.mjs"
echo "left after a clean end: $(left stack-check)"
[ "$(left stack-check)" = 0 ] || { echo "the stack left something behind" >&2; exit 1; }

# Interrupted halfway: the stack is up and its command is running when the run is stopped.
sh "$HERE/stack.sh" run stack-stop sleep 600 &
pid=$!
until docker ps --format '{{.Names}}' | grep -q '^probe-stack-stop-engine$' && [ -f "${STACK_STATE:-${TMPDIR:-/tmp}/gtmworks-engine-stack}/stack-stop.env" ]; do sleep 1; done
sleep 1
kill -INT "$pid" 2>/dev/null || true
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" || true
echo "left after an interrupt: $(left stack-stop)"
[ "$(left stack-stop)" = 0 ] || { echo "the interrupted stack left something behind" >&2; exit 1; }
echo "stack check passed"
