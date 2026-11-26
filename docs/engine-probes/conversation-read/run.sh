#!/bin/sh
# Probe A of spec #822 (#824, #825): prints docs/engine-probes/conversation-read.md's table again on a throwaway Engine
# of the pinned image, then removes it. About 25 minutes; it loads every core of the host for part of it.
#
#   sh docs/engine-probes/conversation-read/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
exec sh "$HERE/../engine-stack/stack.sh" run conversation-read node "$HERE/probe.mjs"
