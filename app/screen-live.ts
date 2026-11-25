'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// The live stream of an Agent's Screen in its large view (#713, ADR 0029): one WebSocket to gtmworks's own
// /api/display/ws (lib/screen-stream.mjs), open while the view is open on an awake Screen. Its binary frames are the
// Screen's RFB stream, drawn by noVNC into `target`; its text frames say who controls the Screen. Taking control and
// giving it back are asked on the same socket, and closing it (the view closed, the page left) gives control back.
// The picture is shown live only while a stream is open: when another person holds control there is none, since it may
// show what they type. A socket that drops is opened again after a moment while the view stays open; one refused for a
// session that needs refreshing first reads the Screen's state, which refreshes it.
export type Control = 'agent' | 'mine' | 'other';
type Rfb = { viewOnly: boolean, scaleViewport: boolean, resizeSession: boolean, focusOnClick: boolean, disconnect: () => void, focus: () => void, addEventListener: (type: string, listener: () => void) => void };
type Events = { taken: () => void, given: () => void, refused: (reason: 'held' | 'notAllowed' | 'failed') => void, lost: () => void };

// The channel noVNC reads one RFB stream from (core/websock.js attach: send, close, binaryType, the on* handlers,
// protocol and readyState): the binary frames of the gtmworks socket between one {stream:'open'} and the next close.
class StreamChannel {
  binaryType = 'arraybuffer'; protocol = ''; readyState = 'connecting';
  onopen: (() => void) | null = null; onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number, reason: string, wasClean: boolean }) => void) | null = null; onerror: ((event: unknown) => void) | null = null;
  constructor(private socket: WebSocket) {}
  send(data: ArrayBuffer | Uint8Array) { if (this.readyState === 'open' && this.socket.readyState === WebSocket.OPEN) this.socket.send(data); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose?.({ code: 1000, reason: '', wasClean: true }); }
  // Frames that arrive while noVNC is still loading wait for it: the first is the server's RFB version.
  private early: ArrayBuffer[] = [];
  opened() { this.readyState = 'open'; this.onopen?.(); for (const data of this.early.splice(0)) this.onmessage?.({ data }); }
  deliver(data: ArrayBuffer) { if (this.readyState === 'open') this.onmessage?.({ data }); else if (this.readyState === 'connecting') this.early.push(data); }
}

const retryMs = 2000;
export function useScreenLive({ company, agent, on, target, onStale }: { company: string, agent: string, on: boolean, target: React.RefObject<HTMLDivElement | null>, onStale: () => void }, events: Events) {
  const [control, setControl] = useState<Control>('agent');
  const [by, setBy] = useState('');
  const [live, setLive] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef(events);
  useEffect(() => { handlers.current = events; });
  const mine = useRef(false);
  const rfb = useRef<Rfb | null>(null);
  const pending = useRef<string[]>([]);

  useEffect(() => {
    if (!on) return;
    let ended = false; let retry: ReturnType<typeof setTimeout> | undefined; let channel: StreamChannel | null = null;
    // noVNC is told first, while it is still connected; it then closes its channel itself.
    const stopStream = () => { const client = rfb.current; rfb.current = null; try { client?.disconnect(); } catch { /* already disconnected */ } channel?.close(); channel = null; setLive(false); };
    const startStream = async (open: WebSocket) => {
      stopStream();
      const here = new StreamChannel(open); channel = here;
      const { default: RFB } = await import('@novnc/novnc') as unknown as { default: new (target: HTMLElement, channel: unknown, options?: object) => Rfb };
      // The element it draws in may be put on the page by the same message that opened the stream.
      for (let frame = 0; frame < 10 && !target.current && !ended && channel === here; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
      if (ended || channel !== here || !target.current) return;
      const client = new RFB(target.current, here, { shared: true });
      client.scaleViewport = true; client.resizeSession = false; client.focusOnClick = true; client.viewOnly = !mine.current;
      client.addEventListener('connect', () => { if (channel === here) setLive(true); });
      client.addEventListener('disconnect', () => { if (rfb.current === client) rfb.current = null; if (channel === here) setLive(false); });
      rfb.current = client;
      here.opened();
    };
    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/display/ws?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}`;
      const open = new WebSocket(url); open.binaryType = 'arraybuffer'; socket.current = open;
      open.addEventListener('open', () => { for (const message of pending.current.splice(0)) open.send(message); });
      open.addEventListener('message', event => {
        if (typeof event.data !== 'string') { channel?.deliver(event.data as ArrayBuffer); return; }
        let message: { control?: Control, by?: string, stream?: string, refused?: 'held' | 'notAllowed' | 'failed', given?: boolean } | null = null;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message) return;
        if (message.stream === 'open') void startStream(open);
        else if (message.stream === 'closed') stopStream();
        if (message.control) {
          const was = mine.current; mine.current = message.control === 'mine';
          setControl(message.control); setBy(message.by ?? '');
          if (rfb.current) rfb.current.viewOnly = !mine.current;
          if (mine.current && !was) { handlers.current.taken(); rfb.current?.focus(); }
        }
        if (message.given) handlers.current.given();
        if (message.refused) handlers.current.refused(message.refused);
      });
      open.addEventListener('close', event => {
        if (socket.current === open) socket.current = null;
        stopStream();
        if (ended) return;
        if (mine.current) { mine.current = false; handlers.current.lost(); }
        setControl('agent'); setBy('');
        if (event.code === 4001 || event.code === 4404) { onStale(); return; }
        if (event.code === 4401) onStale();
        retry = setTimeout(connect, retryMs);
      });
    };
    connect();
    return () => {
      ended = true; clearTimeout(retry); stopStream();
      const open = socket.current; socket.current = null; mine.current = false;
      open?.close(1000);
      setControl('agent'); setBy(''); pending.current = [];
    };
  }, [on, company, agent, target, onStale]);

  const ask = useCallback((message: object) => {
    const text = JSON.stringify(message);
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(text); else pending.current.push(text);
  }, []);
  return { control, by, live, mine: control === 'mine', take: useCallback(() => ask({ take: true }), [ask]), giveBack: useCallback(() => ask({ giveBack: true }), [ask]), held: () => mine.current };
}
