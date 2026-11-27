'use client';
import { useEffect, useRef } from 'react';

// The board's live changes in the browser (#840, spec #831): one WebSocket to gtmworks's own /api/board/events
// (lib/board-stream.mjs) for each Company while anything on the page follows its board, the board and an open Card
// alike. The browser never reaches the Engine; the socket's frames say only whether the Engine's stream is followed
// ({stream:'open'|'down'}) and which Cards changed ({changed:[ids]}), and what changed is read again through gtmworks's
// own routes, which decide what the person sees.
//
// `changed` is called with the ids of the Cards that changed, or with null when anything may have: the stream opened (a
// change may have come between the page's read and the socket), the socket was refused for a session that needs
// refreshing (the read refreshes it), or the person may no longer read the board. `live` says whether changes are
// arriving; while they are not, a follower reads again on its own slow timer. A socket that drops is opened again after
// a pause, longer each time; one closed because the person is no longer a Member is not.
export type BoardFollower = { changed: (cards: string[] | null) => void, live?: (on: boolean) => void };
const againAfter = [1000, 3000, 10000, 30000];
const closed = { signedOut: 4401, notFound: 4404 };

type Channel = { followers: Set<BoardFollower>, socket: WebSocket | null, live: boolean, timer?: ReturnType<typeof setTimeout>, tries: number };
const channels = new Map<string, Channel>();

function connect(company: string, channel: Channel) {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/board/events?company=${encodeURIComponent(company)}`);
  channel.socket = socket;
  const told = (on: boolean) => { if (channel.live === on) return; channel.live = on; for (const follower of channel.followers) follower.live?.(on); };
  const everyone = (cards: string[] | null) => { for (const follower of channel.followers) follower.changed(cards); };
  socket.addEventListener('message', event => {
    if (channel.socket !== socket || typeof event.data !== 'string') return;
    let message: { stream?: string, changed?: unknown } | null = null;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message?.stream === 'open') { channel.tries = 0; told(true); everyone(null); }
    else if (message?.stream === 'down') told(false);
    else if (Array.isArray(message?.changed)) everyone(message.changed.filter((id): id is string => typeof id === 'string'));
  });
  socket.addEventListener('close', event => {
    if (channel.socket !== socket) return;
    channel.socket = null; told(false);
    if (!channel.followers.size) return;
    if (event.code === closed.notFound) { everyone(null); return; }
    if (event.code === closed.signedOut) everyone(null);
    channel.timer = setTimeout(() => { channel.timer = undefined; if (channels.get(company) === channel) connect(company, channel); },againAfter[Math.min(channel.tries++, againAfter.length - 1)]);
  });
}

/** Follows the Company's board until the answer is called. */
export function followBoard(company: string, follower: BoardFollower): () => void {
  let channel = channels.get(company);
  if (!channel) { channel = { followers: new Set(), socket: null, live: false, tries: 0 }; channels.set(company, channel); }
  channel.followers.add(follower);
  if (channel.live) follower.live?.(true);
  if (!channel.socket && channel.timer === undefined) connect(company, channel);
  const own = channel;
  return () => {
    own.followers.delete(follower);
    if (own.followers.size) return;
    channels.delete(company); clearTimeout(own.timer);
    const socket = own.socket; own.socket = null; socket?.close();
  };
}

/** The changes of one Card (an open Card window): `changed` is called when the Card may have changed. */
export function useCardChanges(company: string, card: string | null, changed: () => void) {
  const latest = useRef(changed);
  useEffect(() => { latest.current = changed; });
  useEffect(() => {
    if (!card) return;
    return followBoard(company, { changed: cards => { if (!cards || cards.includes(card)) latest.current(); } });
  }, [company, card]);
}
