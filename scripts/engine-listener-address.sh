#!/bin/sh
# The address one Engine's listeners bind to, written where s6 reads a container's environment (ADR 0018, #393). The
# Engine joins two networks: the install's, which carries its default route, and its Company's work network, which is
# internal. Binding the Run API and the management listener to the wildcard address would answer on both legs, and a
# sandbox can reach the Engine's address on the work network (docs/engine-probes/work-sandbox-ssh.md, section 6), so both
# listen on the install network's own address only.
#
# This hook runs before s6 starts any service, so the dashboard service's with-contenv sees the same address the Engine's
# gateway does. The resolving itself is one python file, which the healthcheck also asks.
set -eu

address=$(/opt/hermes/.venv/bin/python /etc/hermes/listener-address.py)
install -d /run/s6/container_environment
printf '%s' "$address" > /run/s6/container_environment/API_SERVER_HOST
printf '%s' "$address" > /run/s6/container_environment/HERMES_DASHBOARD_HOST
