# Runs in the install gateway container each time it starts, before nginx (docker-compose.install.yml), and writes the
# file scripts/install-nginx.conf includes: whom the gateway believes when a request names its visitor (issue #41).
#
# The gateway publishes its port on 127.0.0.1 only, so every connection from the install machine, whether a browser on it,
# an SSH tunnel or an HTTPS proxy in front of the install, arrives from one address: the bridge gateway of the install
# network, the default route of this container. An HTTPS proxy writes each visitor's address in X-Forwarded-For; the
# gateway takes that address only from this exact peer, so the sign-in rate limit counts per visitor behind the proxy.
# A container on the install network connects from its own address and is never believed. Every process on the install
# machine can reach the published port, and so is trusted to name a visitor (README).
#
# Usage: sh install-gateway-real-ip.sh <output file> [route table, default /proc/net/route]
set -eu
out=$1
routes=${2:-/proc/net/route}
# The default route (destination and mask 0) and its gateway, little-endian hex, as dotted decimal.
address=$(awk '
 function hex(s,  i,n) { n=0; for(i=1;i<=length(s);i++) n=n*16+index("0123456789ABCDEF",toupper(substr(s,i,1)))-1; return n }
 NR>1 && $2=="00000000" && $8=="00000000" && $3!="00000000" {
  printf "%d.%d.%d.%d\n", hex(substr($3,7,2)), hex(substr($3,5,2)), hex(substr($3,3,2)), hex(substr($3,1,2)); exit
 }' "$routes")
if [ -n "$address" ]; then
 printf 'set_real_ip_from %s;\nreal_ip_header X-Forwarded-For;\n' "$address" > "$out"
else
 # Nobody is believed: every visitor counts from its own connection, and behind a proxy all of them share one allowance.
 echo "gtmworks gateway: no install network gateway address; X-Forwarded-For is ignored" >&2
 : > "$out"
fi
