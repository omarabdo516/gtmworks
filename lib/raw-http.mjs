import { STATUS_CODES } from 'node:http';

/**
 * A whole HTTP/1.1 answer of a status alone, written straight on a connection that asked for an upgrade: a socket the
 * web server or the Engine refused (lib/engine-dashboard.mjs, lib/engine/transport.mjs).
 * @param {number} status
 */
export const rawStatus=status=>`HTTP/1.1 ${status} ${STATUS_CODES[status]??''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
