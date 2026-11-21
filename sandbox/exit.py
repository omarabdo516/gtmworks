#!/usr/bin/env python3
"""The one way out of a Company's work sandbox (#394, ADR 0018).

The sandbox's own network is internal: it routes nowhere. This program is the exit, the one container of the Company's
template on that network with a second network that routes out. It is an HTTP proxy, and only that:

- a plain HTTP request is read, its head is checked and rebuilt, and only that request leaves;
- an HTTPS connection is a CONNECT tunnel, and it opens only when the first bytes the client sends are a TLS handshake;
- a port other than 80, 443 or 1024 and above is refused, so no mail, ssh or other well-known service is reached.

The name a request names is resolved here, and every address it resolves to is checked: private, shared, loopback,
link-local (cloud metadata among them), multicast and reserved addresses, and the networks this exit is on, are refused.
The connection is made to the exact address that was checked, never to the name again, so a name that answers one
address to the check and another to the connection (DNS rebinding) changes nothing.

It keeps nothing, holds no key and logs one line per request: the verdict, the host and the port, never a path or a body.
It runs from the work sandbox image the install already has, so an install carries no second image for it.

  python3 exit.py                 serve on the work network (EXIT_LISTEN names the address, default the alias `exit`)
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
# link-local (169.254.169.254, fd00:ec2::254 within fc00::/7) or shared (100.100.100.200) addresses.
REFUSED = [(ipaddress.ip_network(network), reason) for network, reason in (
    ('0.0.0.0/8', 'this network'),
    ('10.0.0.0/8', 'a private address'),
    ('100.64.0.0/10', 'a shared address'),
    ('127.0.0.0/8', 'loopback'),
    ('169.254.169.254/32', 'cloud metadata'),
    ('169.254.0.0/16', 'a link-local address'),
    ('172.16.0.0/12', 'a private address'),
    ('192.0.0.0/24', 'a reserved address'),
    ('192.168.0.0/16', 'a private address'),
    ('198.18.0.0/15', 'a reserved address'),
    ('224.0.0.0/4', 'a multicast address'),
    ('240.0.0.0/4', 'a reserved address'),
    ('::/128', 'this network'),
    ('::1/128', 'loopback'),
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


def allowed_port(port):
    return port in (80, 443) or 1024 <= port <= 65535


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


async def checked(writer, host, port):
    """The addresses the request may reach, or None once the refusal is answered."""
    if not allowed_port(port):
        log('refused (port)', host, port)
        await answer(writer, 403, 'Forbidden', f"The work sandbox's exit refuses port {port}: only HTTP and HTTPS leave.")
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
    """CONNECT: HTTPS only. The tunnel opens to the checked address when the client's first bytes are a TLS handshake
    record; anything else is closed before a byte or a connection leaves."""
    parsed = split_host_port(target, 443)
    if parsed is None:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit needs host:port to open a tunnel.")
        return
    host, port = parsed
    reachable = await checked(writer, host, port)
    if reachable is None:
        return
    writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
    await writer.drain()
    try:
        first = await asyncio.wait_for(reader.readexactly(3), FIRST_BYTES_SECONDS)
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, OSError):
        return
    if first[0] != 0x16 or first[1] != 0x03:
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
    """A plain HTTP request in absolute form: its head is rebuilt for the origin, without the proxy's own headers, and
    the connection closes after the answer, so each request is checked on its own."""
    url = urlsplit(target)
    if url.scheme.lower() != 'http' or not url.netloc or '@' in url.netloc:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit forwards http:// requests and tunnels HTTPS with CONNECT.")
        return
    parsed = split_host_port(url.netloc, 80)
    if parsed is None:
        await answer(writer, 400, 'Bad Request', "The work sandbox's exit cannot read the request's host.")
        return
    host, port = parsed
    reachable = await checked(writer, host, port)
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
    """The exit's own address on the sandbox's network: the alias the template gives it there. The exit never listens on
    the network that routes out, so nothing but the sandbox and its Engine can use it."""
    name = os.environ.get('EXIT_LISTEN', 'exit')
    deadline = time.monotonic() + 60
    while True:
        try:
            return socket.getaddrinfo(name, PORT, type=socket.SOCK_STREAM)[0][4][0]
        except OSError:
            if time.monotonic() > deadline:
                raise SystemExit(f'exit: cannot resolve its own address {name}')
            time.sleep(1)


async def main():
    address = listen_address()
    server = await asyncio.start_server(serve_client, address, PORT, limit=HEAD_LIMIT)
    print(f'exit: listening on {address}:{PORT}', flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--verdict':
        for item in sys.argv[2:]:
            reason = verdict(item)
            print('allowed' if reason is None else f'refused {reason}')
        sys.exit(0)
    asyncio.run(main())
