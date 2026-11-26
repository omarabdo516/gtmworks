#!/bin/sh
# Probe C of spec #822 (#828, #829): prints docs/engine-probes/plugin-tool.md's answers again on a throwaway Engine of
# the pinned image, then removes it. About five minutes.
#
#   sh docs/engine-probes/plugin-tool/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
exec sh "$HERE/../engine-stack/stack.sh" run plugin-tool node "$HERE/probe.mjs"
