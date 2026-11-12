import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { formatTouchDiagnostics, recordTouchDiagnostics, touchDiagnosticsKey, touchDiagnosticsLimit } from './touch-diagnostics.mjs';

// The in-page recorder needs a browser; what reaches the public CI log is decided here, so this is what is tested:
// only known keys, numbers, booleans and listed words survive, and the output is bounded whatever the page stored.
const marker='sk-marker-Qz7v';
const box={x:12.345,y:900.5,width:260,height:96.25};
const hit={tag:'div',inBoard:true,inCard:true,cardId:1,stageId:7,fixedAncestor:false,touchAction:'manipulation',matches:['card','column-body']};
const record={type:'touchstart',t:12.6,x:146.4,y:912.2,cancelable:true,defaultPrevented:false,pointerType:'touch',hit,
 viewport:{width:390,height:844,scrollX:0,scrollY:0,scale:1},board:{scrollLeft:0,scrollWidth:2412,clientWidth:390,scrollTop:0,ariaBusy:false,touchAction:'auto',box},
 card:{box,touchAction:'auto',ariaPressed:false},document:{scrollWidth:390,scrollHeight:1400,clientWidth:390,clientHeight:844}};

test('a recorded swipe prints as bounded numbers and listed words', () => {
 const lines=formatTouchDiagnostics(JSON.stringify([record]));
 assert.equal(lines.length,1);
 assert.match(lines[0],/^touch-diagnostic /);
 const printed=JSON.parse(lines[0].slice('touch-diagnostic '.length));
 assert.equal(printed.type,'touchstart'); assert.equal(printed.x,146); assert.equal(printed.hit.tag,'div');
 assert.deepEqual(printed.hit.matches,['card','column-body']); assert.equal(printed.card.box.y,901);
 assert.equal(printed.board.scrollWidth,2412); assert.equal(printed.viewport.height,844);
});

test('anything outside the known shape is dropped or replaced, never printed', () => {
 const hostile={...record,type:marker,pointerType:marker,secret:marker,x:`${marker}`,t:Number.POSITIVE_INFINITY,
  hit:{...hit,tag:marker,touchAction:marker,matches:[marker,'card',{marker}],cardId:marker,extra:marker},
  board:{...record.board,touchAction:`pan-x ${marker}`,box:{...box,width:1e12}},
  viewport:{...record.viewport,width:marker}, nested:{deep:{marker}}};
 const lines=formatTouchDiagnostics(JSON.stringify([hostile,marker,null,42,[marker]]));
 assert.ok(lines.every(line=>!line.includes(marker)&&!line.includes('Qz7v')),lines.join('\n'));
 const printed=JSON.parse(lines[0].slice('touch-diagnostic '.length));
 assert.equal(printed.type,'other'); assert.equal(printed.pointerType,'other'); assert.equal(printed.secret,undefined);
 assert.equal(printed.x,null); assert.equal(printed.t,null); assert.equal(printed.hit.tag,'other'); assert.equal(printed.hit.touchAction,'other');
 assert.deepEqual(printed.hit.matches,['card']); assert.equal(printed.hit.cardId,null); assert.equal(printed.hit.extra,undefined);
 assert.equal(printed.board.box.width,1e6); assert.equal(printed.viewport.width,null); assert.equal(printed.nested,undefined);
});

test('the output is bounded and unreadable storage prints one fixed line', () => {
 const many=formatTouchDiagnostics(JSON.stringify(Array.from({length:touchDiagnosticsLimit*3},()=>record)));
 assert.equal(many.length,touchDiagnosticsLimit+1);
 assert.match(many.at(-1),/^touch-diagnostic \{"dropped":\d+\}$/);
 assert.ok(many.every(line=>line.length<2000));
 for(const stored of [null,'',`not json ${marker}`,JSON.stringify({marker})]) {
  const lines=formatTouchDiagnostics(stored);
  assert.deepEqual(lines,['touch-diagnostic {"records":0}']);
 }
});

test('the recorder runs from its own source, listens passively and stores what the formatter accepts', () => {
 // Playwright sends the function's source to the page, so it is run here from source in an empty context with a stand-in page.
 const listeners=[], storage=new Map();
 const element=attributes=>({nodeType:1,tagName:'DIV',parentElement:null,getAttribute:name=>attributes[name]??null,
  closest:selector=>selector.includes('.board')||selector.includes('.card')||selector.includes('[data-stage-id]')?element(attributes):null,
  matches:selector=>selector==='.board',getBoundingClientRect:()=>({x:10,y:900,width:260,height:96})});
 const card=element({'data-card-id':'1','data-stage-id':'7','aria-pressed':'false'});
 const page={
  addEventListener:(type,listener,options)=>listeners.push({type,listener,options}),
  sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},
  document:{addEventListener:(type,listener,options)=>listeners.push({type,listener,options}),querySelector:()=>card,elementFromPoint:()=>card,
   documentElement:{scrollWidth:390,scrollHeight:1400,clientWidth:390,clientHeight:844}},
  getComputedStyle:()=>({touchAction:'manipulation',position:'static'}),performance:{now:()=>5},innerWidth:390,innerHeight:844,scrollX:0,scrollY:0,
  visualViewport:{scale:1},Element:Object,
 };
 runInNewContext(`(${recordTouchDiagnostics.toString()})(${JSON.stringify({cardId:1,key:touchDiagnosticsKey,limit:touchDiagnosticsLimit})})`,page);
 assert.deepEqual(listeners.map(listener=>listener.type).sort(),['pointercancel','pointerdown','pointerup','scroll','touchcancel','touchend','touchmove','touchstart']);
 assert.ok(listeners.every(listener=>listener.options?.passive===true),'every listener is passive');
 listeners.find(listener=>listener.type==='touchstart').listener({cancelable:true,defaultPrevented:false,touches:[{clientX:146,clientY:912}],changedTouches:[]});
 listeners.find(listener=>listener.type==='pointerdown').listener({pointerType:'mouse',clientX:1,clientY:1});
 const lines=formatTouchDiagnostics(storage.get(touchDiagnosticsKey));
 assert.equal(lines.length,1,'a mouse pointer is not recorded');
 const printed=JSON.parse(lines[0].slice('touch-diagnostic '.length));
 assert.equal(printed.type,'touchstart'); assert.equal(printed.hit.cardId,1); assert.equal(printed.hit.inBoard,true);
 assert.equal(printed.card.box.y,900); assert.equal(printed.viewport.height,844); assert.equal(printed.document.scrollHeight,1400);
});
