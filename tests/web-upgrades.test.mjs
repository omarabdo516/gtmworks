import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { webUpgrades } from '../lib/web-upgrades.mjs';
import { screenStreamPath } from '../lib/screen-stream.mjs';
import { boardStreamPath } from '../lib/board-stream.mjs';

// ADR 0029: gtmworks's own web server takes the WebSockets it carries itself, the Screen's stream (#713) and the board's
// live changes (#840), each by its own handler; in development any other upgrade (the hot reload) is Next's, and in
// production it is ended.
test('the web server takes the Screen\'s and the board\'s upgrades, leaves others to Next in development, and ends any other in production',()=>{
 const taken=[];
 const socket=()=>new Duplex({read(){},write(_chunk,_encoding,done){ done(); }});
 const asked=path=>new URL(path,'http://gtmworks'), request=/** @type {any} */({});
 for(const dev of [true,false]) {
  const route=webUpgrades({dev,streams:{
   [screenStreamPath]:(_request,_socket,_head,query)=>{ taken.push([dev,'screen',query.get('agent')]); },
   [boardStreamPath]:(_request,_socket,_head,query)=>{ taken.push([dev,'board',query.get('company')]); },
  }});
  const screen=socket(), board=socket(), other=socket();
  route(asked(`${screenStreamPath}?agent=a`),request,screen,Buffer.alloc(0));
  route(asked(`${boardStreamPath}?company=c`),request,board,Buffer.alloc(0));
  route(asked('/_next/webpack-hmr'),request,other,Buffer.alloc(0));
  assert.equal(screen.destroyed,false);
  assert.equal(board.destroyed,false);
  assert.equal(other.destroyed,!dev,dev?'hot reload is Next\'s':'nothing else upgrades');
 }
 assert.deepEqual(taken,[[true,'screen','a'],[true,'board','c'],[false,'screen','a'],[false,'board','c']]);
});
