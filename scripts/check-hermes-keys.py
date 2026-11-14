# CI runs this inside the bundled Hermes container, as its own user, with gtmworks's secrets as NAME=value lines on
# stdin (read from .env.install by the install job). It fails when Hermes's environment names or holds one of them, or
# when a file that user can read holds one. It prints names and paths only, never a value.
# Usage: python check-hermes-secrets.py [root]   (root defaults to /; the unit test scans a folder of its own)
import os
import sys

root = sys.argv[1] if len(sys.argv) > 1 else '/'
secrets = {}
for line in sys.stdin.read().splitlines():
    name, _, value = line.partition('=')
    if name and value:
        secrets[name] = value.encode()
if not secrets:
    print('no secrets were given to check')
    sys.exit(2)

found = []
for name, value in secrets.items():
    if name in os.environ:
        found.append(f'the environment names {name}')
    if any(value in item.encode() for item in os.environ.values()):
        found.append(f'the environment holds the value of {name}')

skip = {'/proc', '/sys', '/dev'}
largest = 64 * 1024 * 1024
for directory, folders, files in os.walk(root, followlinks=False):
    folders[:] = [folder for folder in folders if os.path.join(directory, folder) not in skip]
    for file in files:
        path = os.path.join(directory, file)
        try:
            if not os.path.isfile(path) or os.path.islink(path) or os.path.getsize(path) > largest:
                continue
            with open(path, 'rb') as handle:
                content = handle.read()
        except OSError:
            continue
        for name, value in secrets.items():
            if value in content:
                found.append(f'{path} holds the value of {name}')

for line in found:
    print(line)
print(f'checked {len(secrets)} secret(s): {"found" if found else "none found"}')
sys.exit(1 if found else 0)
