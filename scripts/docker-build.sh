#!/usr/bin/env bash
# `docker build` with the machine's extra CA handed to the build (#562). A Claude Code cloud session's network re-signs
# every TLS connection with the session's own CA: the host's Node trusts it through NODE_EXTRA_CA_CERTS, and a build's
# `npm ci` and `next build` (the Google fonts) do not, so they fail with SELF_SIGNED_CERT_IN_CHAIN. When that variable
# names a file, it goes to the build as the BuildKit secret `build-ca`, which the Dockerfile's npm steps trust only while
# they run: a secret is mounted for one step, never written to a layer or the build cache's key. Without one (CI, a
# release, a machine with no extra CA) this is the plain `docker build` it always was.
#   bash scripts/docker-build.sh -t gtmworks:ci .
set -euo pipefail
ca=()
if [[ -n ${NODE_EXTRA_CA_CERTS:-} && -f $NODE_EXTRA_CA_CERTS ]]; then ca=(--secret "id=build-ca,src=$NODE_EXTRA_CA_CERTS"); fi
exec docker build ${ca[@]+"${ca[@]}"} "$@"
