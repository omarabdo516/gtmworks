// The web server's upgrades (ADR 0029), by the path asked (scripts/web-server.mjs reads it): the WebSockets gtmworks
// carries itself, the Screen's stream (lib/screen-stream.mjs) and the board's (lib/board-stream.mjs), each taken by its
// own handler. In development every other upgrade (the hot reload) is Next's, which attaches its own handler; in
// production nothing else upgrades, so any other is ended.
/** @typedef {(request:import('node:http').IncomingMessage,socket:import('node:stream').Duplex,head:Buffer,query:URLSearchParams)=>unknown} Upgrade */
/** @param {{dev:boolean,streams:Record<string,Upgrade>}} options */
export function webUpgrades({dev,streams}) {
 const taken=new Map(Object.entries(streams));
 /** @param {URL} asked @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head */
 return (asked,request,socket,head)=>{
  const stream=taken.get(asked.pathname);
  if(stream) void stream(request,socket,head,asked.searchParams);
  else if(!dev) socket.destroy();
 };
}
