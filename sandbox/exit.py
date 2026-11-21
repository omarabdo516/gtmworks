#!/usr/bin/env python3
"""The one way out of a Company's work sandbox (#394, ADR 0018).

The sandbox's own network is internal: it routes nowhere. This program is the exit, the one container of the Company's
template on that network with a second network that routes out. It is an HTTP proxy, and only that:

- a plain HTTP request is read, its head is checked and rebuilt, and only that request leaves;
- an HTTPS connection is a CONNECT tunnel to port 443, and it opens only when the first bytes the client sends are the
  header of a TLS ClientHello record;
- a plain request goes to port 80 and a tunnel to port 443, and every other port is refused, so no mail, ssh, database
  or other service is reached, whatever its port.

The name a request names is resolved here, and every address it resolves to is checked: private, shared, loopback,
link-local (cloud metadata among them), multicast and reserved addresses, and the networks this exit is on, are refused.
The connection is made to the exact address that was checked, never to the name again, so a name that answers one
address to the check and another to the connection (DNS rebinding) changes nothing.

It keeps nothing, holds no key and logs one line per request: the verdict, the host and the port, never a path or a body.
It runs from the work sandbox image the install already has, so an install carries no second image for it.

  python3 exit.py                 serve on the work network (its address beside the sandbox, or EXIT_LISTEN)
  python3 exit.py --health        exit 0 when the exit answers there
  python3 exit.py --verdict ADDR  print `allowed` or `refused <reason>` for each address, as the exit decides it
"""
import asyncio
import ipaddress
import os
import socket
import struct
import sys
import time
from urllib.parse import urlsplit

PORT = int(os.environ.get('EXIT_PORT', '3128'))
# The ranges no request may reach, whatever name it gives. Each is a place inside a server or its provider, never a
# public site: the install's own Docker networks are private ranges, and the metadata services of the clouds sit on
# link-local (169.254.169.254, fd00:ec2::254 within fc00::/7) or shared (100.100.100.200) addresses, and Azure's
# WireServer on a public one (168.63.129.16), which an Azure host answers for its machines' platform settings.
REFUSED = [(ipaddress.ip_network(network), reason) for network, reason in (
    ('0.0.0.0/8', 'this network'),
    ('10.0.0.0/8', 'a private address'),
    ('100.64.0.0/10', 'a shared address'),
    ('127.0.0.0/8', 'loopback'),
    ('169.254.169.254/32', 'cloud metadata'),
    ('168.63.129.16/32', 'cloud metadata'),
    ('169.254.0.0/16', 'a link-local address'),
    ('172.16.0.0/12', 'a private address'),
    ('192.0.0.0/24', 'a reserved address'),
    ('192.168.0.0/16', 'a private address'),
    ('198.18.0.0/15', 'a reserved address'),
    ('224.0.0.0/4', 'a multicast address'),
    ('240.0.0.0/4', 'a reserved address'),
    ('::/128', 'this network'),
    ('::1/128', 'loopback'),
    ('::/96', 'an IPv4-compatible address'),
    ('::ffff:0:0:0/96', 'a translated address'),
    ('64:ff9b::/96', 'a translated address'),
    ('64:ff9b:1::/48', 'a translated address'),
    ('100::/64', 'a reserved address'),
    ('2001::/32', 'a tunnelled address'),
    ('2002::/16', 'a tunnelled address'),
    ('fd00:ec2::254/128', 'cloud metadata'),
    ('fc00::/7', 'a private address'),
    ('fe80::/10', 'a link-local address'),
    ('fec0::/10', 'a link-local address'),
    ('ff00::/8', 'a multicast address'),
)]
HEAD_LIMIT = 64 * 1024
HEAD_SECONDS = 30
CONNECT_SECONDS = 15
# A connection the exit holds open waits this long for its first bytes; a tunnel that has started is the client's to end.
FIRST_BYTES_SECONDS = 30
HOP_HEADERS = {b'connection', b'keep-alive', b'proxy-connection', b'proxy-authorization', b'proxy-authenticate', b'te',
               b'trailer', b'upgrade'}


def attached_networks():
    """The networks this exit is attached to, read from the kernel's routes: an install network a Docker address pool put
    outside the private ranges is still refused, because the exit is on it or beside it."""
    networks = []
    try:
        with open('/proc/net/route') as routes:
            next(routes, None)
            for line in routes:
                fields = line.split()
                if len(fields) < 8 or fields[2] != '00000000' or fields[1] == '00000000':
                    continue
                address = ipaddress.IPv4Address(struct.pack('<I', int(fields[1], 16)))
                mask = ipaddress.IPv4Address(struct.pack('<I', int(fields[7], 16)))
                networks.append(ipaddress.ip_network(f'{address}/{mask}', strict=False))
    except OSError:
        pass
    try:
        with open('/proc/net/ipv6_route') as routes:
            for line in routes:
                fields = line.split()
                if len(fields) < 10 or int(fields[1], 16) == 0 or fields[4] != '0' * 32:
                    continue
                network = ipaddress.ip_network(f'{ipaddress.IPv6Address(bytes.fromhex(fields[0]))}/{int(fields[1], 16)}', strict=False)
                if network.prefixlen < 128:
                    networks.append(network)
    except OSError:
        pass
    return networks


ATTACHED = attached_networks()


def verdict(address):
    """None when the address may be reached, else the reason it is refused."""
    try:
        ip = ipaddress.ip_address(address.split('%', 1)[0])
    except ValueError:
        return 'not an address'
    # An IPv4 address written as IPv6 is judged as the IPv4 address it is.
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    for network, reason in REFUSED:
        if ip.version == network.version and ip in network:
            return reason
    for network in ATTACHED:
        if ip.version == network.version and ip in network:
            return "a network of the exit's own"
    return None


def client_hello(header):
    """True when six bytes open a TLS record as a client's first flight does: a handshake record (0x16) of version
    0x0301-0x0304, a length a record may have, and a handshake message that is a ClientHello (0x01)."""
    length = int.from_bytes(header[3:5], 'big')
    return header[0] == 0x16 and header[1] == 0x03 and 0x01 <= header[2] <= 0x04 and 4 <= length <= 16384 and header[5] == 0x01


def printable(text):
    return ''.join(c if 32 < ord(c) < 127 else '?' for c in str(text))[:200]


def log(verdict_text, host, port):
    print(f'exit: {verdict_text} {printable(host)}:{port}', flush=True)


async def answer(writer, status, reason, text):
    """The exit's own answer. A 403 is a refusal by the rules above and says so in a header of its own, so a probe tells
    it from a site's own 403."""
    body = (text + '\n').encode()
    mark = 'X-Gtmworks-Exit: refused\r\n' if status == 403 else ''
    writer.write(f'HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {len(body)}\r\n'
                 f'{mark}Connection: close\r\n\r\n'.encode() + body)
    try:
        await writer.drain()
    except OSError:
        pass


async def resolve(host, port):
    """Every address the name resolves to here, and the ones the exit may reach. A literal address resolves to itself, and
    a number in another form (2130706433, 0x7f.1) resolves to the address it means, which is the one judged."""
    loop = asyncio.get_running_loop()
    try:
        infos = await asyncio.wait_for(loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), CONNECT_SECONDS)
    except (OSError, asyncio.TimeoutError, UnicodeError):
        return [], []
    addresses = []
    for family, _, _, _, sockaddr in infos:
        if family in (socket.AF_INET, socket.AF_INET6) and sockaddr[0] not in addresses:
            addresses.append(sockaddr[0])
    return addresses, [address for address in addresses if verdict(address) is None]


async def open_upstream(addresses, port):
    """A connection to the first address that answers, by that exact address: the name is never looked up again."""
    for address in addresses:
        try:
            return await asyncio.wait_for(asyncio.open_connection(address, port), CONNECT_SECONDS)
        except (OSError, asyncio.TimeoutError):
            continue
    return None


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (OSError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            if writer.can_write_eof():
                writer.write_eof()
        except OSError:
            pass


async def splice(client_reader, client_writer, upstream_reader, upstream_writer):
    await asyncio.gather(pipe(client_reader, upstream_writer), pipe(upstream_reader, client_writer))
    upstream_writer.close()


def split_host_port(authority, default_port):
    """host and port from `host:port` or `[v6]:port`; None when it is neither."""
    if authority.startswith('['):
        end = authority.find(']')
        if end < 0:
            return None
        host, rest = authority[1:end], authority[end + 1:]
        if rest and not rest.startswith(':'):
            return None
        port_text = rest[1:] if rest else ''
    else:
        host, _, port_text = authority.rpartition(':') if ':' in authority else (authority, '', '')
    if not host:
        return None
    if not port_text:
        return host, default_port
    if not port_text.isdigit():
        return None
    return host, int(port_text)


async def checked(writer, host, port, allowed):
    """The addresses the request may reach, or None once the refusal is answered."""
    if port != allowed:
        log('refused (port)', host, port)
        await answer(writer, 403, 'Forbidden', f"The work sandbox's exit refuses port {port}: only HTTP to port 80 and HTTPS to port 443 leave.")
        return None
    addresses, reachable = await resolve(host, port)
    if not addresses:
        log('unresolved', host, port)
        await answer(writer, 502, 'Bad Gateway', f"The work sandbox's exit cannot resolve {printable(host)}.")
        return None
    if not reachable:
        reason = verdict(addresses[0])
        log(f'refused ({reason})', host, port)
        await answer(writer, 403, 'Forbidden', f"The work sandbox's exit refuses {printable(host)}: it is {reason}.")
        return None
    return reachable


async def tunnel(reader, writer, target):
    """CONNECT: HTTPS to port 443 only. The tunnel opens to the checked address when the client's first bytes are a TLS
    ClientHello record header; anything else is closed before a byte or a connection leaves."""
    parsed = split_host_port(target, 443)
    if parsed is None:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit needs host:port to open a tunnel.")
        return
    host, port = parsed
    reachable = await checked(writer, host, port, 443)
    if reachable is None:
        return
    writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
    await writer.drain()
    try:
        first = await asyncio.wait_for(reader.readexactly(6), FIRST_BYTES_SECONDS)
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, OSError):
        return
    if not client_hello(first):
        log('refused (not TLS)', host, port)
        return
    upstream = await open_upstream(reachable, port)
    if upstream is None:
        log('unreachable', host, port)
        return
    log('tunnel', host, port)
    upstream_reader, upstream_writer = upstream
    upstream_writer.write(first)
    await splice(reader, writer, upstream_reader, upstream_writer)


async def forward(reader, writer, method, target, version, header_lines):
    """A plain HTTP request in absolute form to port 80: its first head is rebuilt for the origin, without the proxy's
    own headers. The connection is then spliced to that origin, so a request pipelined after it on the same connection
    goes, unread, to the same checked address and nowhere else."""
    url = urlsplit(target)
    if url.scheme.lower() != 'http' or not url.netloc or '@' in url.netloc:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit forwards http:// requests and tunnels HTTPS with CONNECT.")
        return
    parsed = split_host_port(url.netloc, 80)
    if parsed is None:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit cannot read the request's host.")
        return
    host, port = parsed
    reachable = await checked(writer, host, port, 80)
    if reachable is None:
        return
    upstream = await open_upstream(reachable, port)
    if upstream is None:
        log('unreachable', host, port)
        await answer(writer, 502, 'Bad Gateway', f"The work sandbox's exit cannot reach {printable(host)}.")
        return
    log('forward', host, port)
    upstream_reader, upstream_writer = upstream
    path = url.path or '/'
    if url.query:
        path += '?' + url.query
    head = [f'{method} {path} {version}'.encode('latin-1')]
    has_host = False
    for line in header_lines:
        name = line.split(b':', 1)[0].strip().lower()
        if name in HOP_HEADERS:
            continue
        has_host = has_host or name == b'host'
        head.append(line)
    if not has_host:
        head.append(b'Host: ' + url.netloc.encode('latin-1'))
    head.append(b'Connection: close')
    upstream_writer.write(b'\r\n'.join(head) + b'\r\n\r\n')
    await splice(reader, writer, upstream_reader, upstream_writer)


async def serve_client(reader, writer):
    try:
        try:
            head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), HEAD_SECONDS)
        except asyncio.LimitOverrunError:
            await answer(writer, 431, 'Request Header Fields Too Large', "The work sandbox's exit reads a request head of 64 KB at most.")
            return
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, OSError):
            return
        lines = head[:-4].split(b'\r\n')
        parts = lines[0].decode('latin-1').split(' ')
        if len(parts) != 3 or not parts[2].startswith('HTTP/1.'):
            await answer(writer, 400, 'Bad Request', "The work sandbox's exit speaks HTTP only.")
            return
        method, target, version = parts
        if method.upper() == 'CONNECT':
            await tunnel(reader, writer, target)
        else:
            await forward(reader, writer, method, target, version, lines[1:])
    except Exception as error:  # one client's failure never stops the exit
        print(f'exit: error {type(error).__name__}', flush=True)
    finally:
        try:
            writer.close()
        except OSError:
            pass


def listen_address():
    """The exit's own address on the sandbox's network. Its alias there is no help from inside: Compose also gives every
    service its own name on each network it joins, so a lookup can answer the address on the network that routes out.
    The address is the one the kernel would send from to reach the sandbox (EXIT_PEER, the sandbox's alias, which is on
    the work network only); a datagram socket is pointed at it and nothing is sent. The exit never listens on the network
    that routes out, so nothing but the sandbox and its Engine can use it. EXIT_LISTEN names the address outright."""
    if os.environ.get('EXIT_LISTEN'):
        return os.environ['EXIT_LISTEN']
    peer = os.environ.get('EXIT_PEER', 'sandbox')
    deadline = time.monotonic() + 120
    while True:
        try:
            address = socket.getaddrinfo(peer, 9, socket.AF_INET, socket.SOCK_DGRAM)[0][4][0]
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect((address, 9))
                return probe.getsockname()[0]
        except OSError:
            if time.monotonic() > deadline:
                raise SystemExit(f'exit: cannot find its address beside {peer}')
            time.sleep(1)


def healthy():
    """The health check: the exit answers on its work-network address."""
    try:
        socket.create_connection((listen_address(), PORT), 3).close()
        return 0
    except OSError:
        return 1


async def main():
    address = listen_address()
    server = await asyncio.start_server(serve_client, address, PORT, limit=HEAD_LIMIT)
    print(f'exit: listening on {address}:{PORT}', flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--health':
        sys.exit(healthy())
    if len(sys.argv) > 1 and sys.argv[1] == '--verdict':
        for item in sys.argv[2:]:
            reason = verdict(item)
            print('allowed' if reason is None else f'refused {reason}')
        sys.exit(0)
    asyncio.run(main())
