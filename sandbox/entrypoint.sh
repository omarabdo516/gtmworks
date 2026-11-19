#!/bin/sh
# Starts a work sandbox: host keys of its own, the public key that arrived at run time, and the sshd the Engine's `ssh`
# backend reaches. Nothing secret is in the image, and with no key the container still starts and accepts nobody.
set -eu

# The base image's ordinary user. sshd runs as this user and only ever becomes the user it already is, so the container
# needs no capability and no new privilege to reach the work.
user=pn
home=$(getent passwd "$user" | cut -d: -f 6)
keys_file=${SSH_AUTHORIZED_KEYS_FILE:-/run/authorized_keys}
env_key=${SSH_AUTHORIZED_KEY:-}

# Each container gets a host key of its own, so no host key is baked into an image every install runs.
install -d -m 700 "$home/.ssh"
[ -f "$home/.ssh/ssh_host_ed25519_key" ] \
  || ssh-keygen -q -t ed25519 -N '' -C 'gtmworks-work-sandbox' -f "$home/.ssh/ssh_host_ed25519_key"

if [ -s "$keys_file" ]; then
  cat "$keys_file" > "$home/.ssh/authorized_keys"
elif [ -n "$env_key" ]; then
  printf '%s\n' "$env_key" > "$home/.ssh/authorized_keys"
else
  echo 'work sandbox: no public key arrived; sshd starts and accepts no login' >&2
  rm -f "$home/.ssh/authorized_keys"
fi
[ ! -f "$home/.ssh/authorized_keys" ] || chmod 600 "$home/.ssh/authorized_keys"

exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
