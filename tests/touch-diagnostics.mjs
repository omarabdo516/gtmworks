// A passive record of a touch test's touches, for CI, which keeps no trace of functional tests (tests/app.spec.ts).
// recordTouchDiagnostics runs in the page as an init script: passive listeners only, it never changes an event, and it
// stores numbers, booleans and fixed words in sessionStorage, which survives the test's own navigations. Read back on
// failure, formatTouchDiagnostics prints only the known shape below: no text, address or value from the page.

export const touchDiagnosticsKey='gtmworks-touch-diagnostics';
export const touchDiagnosticsLimit=80;

export function recordTouchDiagnostics({cardId,key,limit}) {
 const box=element=>{ if(!element) return null; const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
 const touchAction=element=>element?getComputedStyle(element).touchAction:null;
 const selectors={board:'.board',column:'.column','column-body':'.column-body',card:'.card','card-link':'.card a',dialog:'dialog,[role=dialog]',
  sheet:'[data-slot=sheet-content]','mobile-menu':'.mobile-menu',header:'header',sidebar:'.sidebar','work-toolbar':'.work-toolbar','work-filters':'.work-filters'};
 const describe=element=>{
  if(!element) return null;
  let fixedAncestor=false;
  for(let node=element;node&&node.nodeType===1;node=node.parentElement) { const position=getComputedStyle(node).position; if(position==='fixed'||position==='sticky') { fixedAncestor=true; break; } }
  const card=element.closest('.card[data-card-id]'), stage=element.closest('[data-stage-id]');
  return {tag:element.tagName.toLowerCase(),inBoard:!!element.closest('.board'),inCard:!!card,cardId:card?Number(card.getAttribute('data-card-id')):null,
   stageId:stage?Number(stage.getAttribute('data-stage-id')):null,fixedAncestor,touchAction:touchAction(element),
   matches:Object.entries(selectors).filter(([,selector])=>element.closest(selector)).map(([name])=>name)};
 };
 const snapshot=(type,event,point)=>{
  const board=document.querySelector('.board'), card=document.querySelector(`.card[data-card-id="${cardId}"]`);
  const root=document.scrollingElement||document.documentElement;
  return {type,t:performance.now(),x:point?point.x:null,y:point?point.y:null,cancelable:event?event.cancelable:null,defaultPrevented:event?event.defaultPrevented:null,
   pointerType:event&&'pointerType' in event?event.pointerType:null,hit:point?describe(document.elementFromPoint(point.x,point.y)):null,
   viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,scale:visualViewport?visualViewport.scale:null},
   board:board&&{scrollLeft:board.scrollLeft,scrollWidth:board.scrollWidth,clientWidth:board.clientWidth,scrollTop:board.scrollTop,ariaBusy:board.getAttribute('aria-busy')==='true',touchAction:touchAction(board),box:box(board)},
   card:card&&{box:box(card),touchAction:touchAction(card),ariaPressed:card.getAttribute('aria-pressed')==='true'},
   document:{scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight,clientWidth:root.clientWidth,clientHeight:root.clientHeight}};
 };
 let last='';
 const save=record=>{
  try {
   const list=JSON.parse(sessionStorage.getItem(key)||'[]');
   if(Array.isArray(list)&&list.length<limit) { list.push(record); sessionStorage.setItem(key,JSON.stringify(list)); }
  } catch { /* a full or blocked storage only loses the record */ }
  last=record.type;
 };
 const touchPoint=event=>{ const touch=event.touches[0]||event.changedTouches[0]; return touch?{x:touch.clientX,y:touch.clientY}:null; };
 // Bubble phase on window: after the card's own handlers, so a drag's preventDefault shows in defaultPrevented.
 for(const type of ['touchstart','touchmove','touchend','touchcancel']) addEventListener(type,event=>save(snapshot(type,event,touchPoint(event))),{passive:true});
 // Mouse clicks elsewhere in the test are not recorded; touch pointers are, without pointermove.
 for(const type of ['pointerdown','pointerup','pointercancel']) addEventListener(type,event=>{ if(event.pointerType==='touch') save(snapshot(type,event,{x:event.clientX,y:event.clientY})); },{passive:true});
 // One record for each run of board scroll events.
 document.addEventListener('scroll',event=>{ if(event.target instanceof Element&&event.target.matches('.board')&&last!=='scroll') save(snapshot('scroll',null,null)); },{passive:true,capture:true});
}

const words={
 type:['touchstart','touchmove','touchend','touchcancel','pointerdown','pointerup','pointercancel','scroll'],
 pointerType:['touch','mouse','pen'],
 tag:['html','body','main','div','section','article','aside','header','nav','a','p','span','strong','bdi','time','i','img','svg','path','h1','h2','h3','button','label','input','select','textarea','form','ol','ul','li','dialog'],
 touchAction:['auto','none','manipulation','pan-x','pan-y','pan-x pan-y','pinch-zoom','pan-x pinch-zoom','pan-y pinch-zoom'],
 matches:['board','column','column-body','card','card-link','dialog','sheet','mobile-menu','header','sidebar','work-toolbar','work-filters'],
};
const number=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(-1e6,Math.min(1e6,Math.round(value))):null;
const ratio=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value*100)/100)):null;
const id=value=>Number.isSafeInteger(value)&&value>=0&&value<=1e9?value:null;
const flag=value=>typeof value==='boolean'?value:null;
const word=list=>value=>value==null?null:list.includes(value)?value:'other';
const object=shape=>value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(shape).map(([name,read])=>[name,read(value[name])])):null;
const boxShape=object({x:number,y:number,width:number,height:number});
const recordShape=object({
 type:word(words.type),t:number,x:number,y:number,cancelable:flag,defaultPrevented:flag,pointerType:word(words.pointerType),
 hit:object({tag:word(words.tag),inBoard:flag,inCard:flag,cardId:id,stageId:id,fixedAncestor:flag,touchAction:word(words.touchAction),
  matches:value=>Array.isArray(value)?value.filter(name=>words.matches.includes(name)).slice(0,words.matches.length):null}),
 viewport:object({width:number,height:number,scrollX:number,scrollY:number,scale:ratio}),
 board:object({scrollLeft:number,scrollWidth:number,clientWidth:number,scrollTop:number,ariaBusy:flag,touchAction:word(words.touchAction),box:boxShape}),
 card:object({box:boxShape,touchAction:word(words.touchAction),ariaPressed:flag}),
 document:object({scrollWidth:number,scrollHeight:number,clientWidth:number,clientHeight:number}),
});

export function formatTouchDiagnostics(stored) {
 let list;
 try { list=JSON.parse(stored); } catch { list=null; }
 if(!Array.isArray(list)) return ['touch-diagnostic {"records":0}'];
 const records=list.filter(record=>record&&typeof record==='object'&&!Array.isArray(record));
 const lines=records.slice(0,touchDiagnosticsLimit).map(record=>`touch-diagnostic ${JSON.stringify(recordShape(record))}`);
 if(records.length>touchDiagnosticsLimit) lines.push(`touch-diagnostic ${JSON.stringify({dropped:records.length-touchDiagnosticsLimit})}`);
 return lines.length?lines:['touch-diagnostic {"records":0}'];
}
