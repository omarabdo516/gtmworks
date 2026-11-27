#!/bin/sh
# Probe of spec #935 (#936): prints docs/engine-probes/provider-key.md's answers again on a throwaway Engine of the
# pinned image, then removes it. A few minutes, most of it the Engine's own start and a handful of Runs.
#
#   sh docs/engine-probes/provider-key/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
exec sh "$HERE/../engine-stack/stack.sh" run provider-key node "$HERE/probe.mjs"
