import { dashboardSlug } from './engine-dashboard.mjs';

// The web server's upgrades (ADR 0029), by the path asked (scripts/web-server.mjs reads it): the WebSockets gtmworks
// carries itself, the Screen's stream (lib/screen-stream.mjs) and the board's (lib/board-stream.mjs), each taken by its
// own handler, and a socket of a Company's Hermes dashboard, which goes to its gate (lib/engine-dashboard.mjs, #869). In
// development every other upgrade (the hot reload) is Next's, which attaches its own handler; in production nothing else
// upgrades, so any other is ended. Answers whether it took the upgrade: Next's own handler must never see one taken
// here, since it ends any upgrade on a path an app route matches, as the dashboard's are.
/** @typedef {(request:import('node:http').IncomingMessage,socket:import('node:stream').Duplex,head:Buffer,query:URLSearchParams)=>unknown} Upgrade */
/** @typedef {(request:import('node:http').IncomingMessage,socket:import('node:stream').Duplex,head:Buffer,asked:URL)=>unknown} Gate */
/** @param {{dev:boolean,streams:Record<string,Upgrade>,dashboard?:Gate}} options */
export function webUpgrades({dev,streams,dashboard}) {
 const taken=new Map(Object.entries(streams));
 /** @param {URL} asked @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head */
 return (asked,request,socket,head)=>{
  const stream=taken.get(asked.pathname);
  if(stream) void stream(request,socket,head,asked.searchParams);
  else if(dashboard&&dashboardSlug(asked.pathname)) void dashboard(request,socket,head,asked);
  else if(!dev) socket.destroy();
  else return false;
  return true;
 };
}
