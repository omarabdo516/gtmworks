"""The address one Engine's listeners bind to: its own address on the install network, never the wildcard address.

The Engine joins two networks: the install's, which also carries its default route, and its Company's work network,
which is internal and has no route out. Binding the Run API and the management listener to the wildcard address would
answer on both legs, and a sandbox can reach the Engine's address on the work network (docs/engine-probes/work-sandbox-ssh.md,
section 6). So the address is resolved at start from the interface that carries the default route, which is the install
network's, and the listeners bind to it alone.

It is one file so the start command (scripts/engine-template.yml) and the healthcheck ask the same question. Only the
standard library is used: the Engine image has no `ip`, `ss`, `hostname` or `getent`, but it has its own python.

    python3 engine-listener-address.py           # prints the address
    python3 engine-listener-address.py --health  # asks the Run API's /health at that address, failing if it is not 200
"""
from __future__ import annotations

import fcntl
import socket
import struct
import sys
import urllib.request

SIOCGIFADDR = 0x8915


def install_network_address() -> str:
    """The IPv4 address of the interface that carries the default route (the install network)."""
    with open("/proc/net/route", encoding="ascii") as routes:
        rows = [line.split() for line in routes.read().splitlines()[1:]]
    for row in rows:
        # Iface Destination Gateway Flags ...; the default route's destination is 0 and its flags carry RTF_GATEWAY.
        if len(row) < 4 or row[1] != "00000000" or not int(row[3], 16) & 0x2:
            continue
        request = struct.pack("256s", row[0].encode("ascii")[:15])
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            answer = fcntl.ioctl(probe.fileno(), SIOCGIFADDR, request)
        return socket.inet_ntoa(answer[20:24])
    raise SystemExit("The Engine has no route to its install network: start it with scripts/install.sh.")


def main(argv: list[str]) -> int:
    address = install_network_address()
    if argv == ["--health"]:
        with urllib.request.urlopen(f"http://{address}:8642/health", timeout=5) as answer:
            if answer.status != 200:
                return 1
        return 0
    print(address)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
