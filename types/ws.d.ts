// The part of the `ws` client tests/agent-screen.spec.ts and tests/engine-dashboard.spec.ts use to open a socket as a signed-in person (#713, #869): `ws`
// ships no typings, and Node's own WebSocket sends no cookie or Origin of a caller's choosing.
declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  export default class WebSocket {
    constructor(address: string, options?: { headers?: Record<string, string> });
    send(data: string | Uint8Array): void;
    close(code?: number): void;
    terminate(): void;
    on(event: 'message', listener: (data: Buffer, binary: boolean) => void): this;
    on(event: 'close', listener: (code: number) => void): this;
    on(event: 'unexpected-response', listener: (request: unknown, response: IncomingMessage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
