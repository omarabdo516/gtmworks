"""Connection attempts from inside the second container: the Engine's Run API and management
listener, on the address it has on this network and on the address it has on the install network."""
import socket
import sys

RUN_API = 8642
MANAGEMENT = 9119


def attempt(address: str, port: int) -> str:
    sock = socket.socket()
    sock.settimeout(4)
    try:
        sock.connect((address, port))
        return "open"
    except Exception as error:  # noqa: BLE001 - the kind of refusal is the answer
        return type(error).__name__
    finally:
        sock.close()


for port, name in ((RUN_API, "Run API"), (MANAGEMENT, "management listener")):
    for address in sys.argv[1:]:
        print(f"21 {name} at {address}:{port}: {attempt(address, port)}")
