'use client';
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useI18n } from '@/lib/i18n-client';
import { BoardIcon } from '@/components/board-icon';
import { prefersReducedMotion } from '@/lib/motion';
import { inEdgeBand, placeChanges, scrollAxes } from '@/lib/board-columns.mjs';
import '@/app/board.css';

// Where a carried Card would land (#174): the column under it, and the Card it would sit above (null at the column's end).
type DropPlace={column:string|null,before:number|null};
const nowhere:DropPlace={column:null,before:null};
// Within this many pixels of either edge of the board, a carried Card scrolls the columns (design-reference: dragMove).
const edge=72;
// The board tells its columns and Cards where the carried Card would land, so the line shows before that Card or at the
// column's end (design-reference: dragMove, .is-drop-before, .is-drop-end).
const DropMark=createContext<{place:DropPlace,carrying:boolean,returning:number|null}>({place:nowhere,carrying:false,returning:null});

// The approved design's board (design-reference: #board-cols, .col, .kcard). A card is carried anywhere with the mouse or
// a finger, and lands above the Card it is dropped on, or at the column's end; the keyboard places it with Shift and the
// arrows (handled by the card's page).
export function KanbanColumn({column,name,count,waiting=false,head,children,...props}:{column:string,name:string,count:number,waiting?:boolean,head?:ReactNode,children:ReactNode}&ComponentProps<'section'>) {
 const {setNodeRef,isOver,active}=useDroppable({id:`column:${column}`});
 const {place,carrying}=useContext(DropMark);
 const blocked=isOver&&active?.data.current?.blocked?.(column);
 const dropEnd=carrying&&place.column===column&&place.before===null&&!blocked;
 return <section ref={setNodeRef} {...props} data-column={column} aria-labelledby={`col-${column}`} className={`col${waiting?' col--waiting':''}${isOver?(blocked?' is-blocked':' is-over'):''}`}>
  <div className="col__head">{waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}<h2 className="col__name" id={`col-${column}`}>{name}</h2><span className={`col__count num${waiting?' approval-count':''}`}>{count}</span>{head}</div>
  <div className={`col__body${dropEnd?' is-drop-end':''}`}>{children}</div>
 </section>;
}

export function KanbanCard({children,id,column,isOverlay=false,disabled=false,blocked,className='',...props}:Omit<ComponentProps<'div'>,'id'>&{id:number,column:string,isOverlay?:boolean,disabled?:boolean,blocked?:(to:string)=>boolean}) {
 const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id,disabled:disabled||isOverlay,data:{column,blocked}});
 const {place,carrying,returning}=useContext(DropMark);
 // The card's link is the one stop for the keyboard; the draggable box itself is not a second one.
 const {role:_role,tabIndex:_tab,'aria-describedby':_hint,'aria-roledescription':_kind,...rest}=attributes;
 void _role; void _tab; void _hint; void _kind;
 const before=carrying&&!isOverlay&&place.before===id;
 return <div {...props} ref={isOverlay?undefined:setNodeRef} {...(isOverlay?{}:rest)} {...(isOverlay?{}:listeners)} data-card-id={isOverlay?undefined:id} aria-hidden={isOverlay||undefined}
  className={`kcard card ${className}${(isDragging||returning===id)&&!isOverlay?' is-drag-src':''}${before?' is-drop-before':''}${isOverlay?' kcard--ghost':''}`}>{children}</div>;
}

// The Card lands where it was put (design-reference: land): it springs from where it was carried into its place and is
// outlined for a moment; a person who wants less motion gets neither.
export function land(el:HTMLElement|null,from:{left:number,top:number}|null=null) {
 if(!el||prefersReducedMotion()) return;
 const to=el.getBoundingClientRect();
 el.style.transition='none';
 el.style.transform=`translate(${from?from.left-to.left:0}px, ${from?from.top-to.top:-6}px)${from?' rotate(2deg) scale(1.03)':''}`;
 void el.offsetWidth;
 el.style.transition='transform 320ms var(--gw-ease-spring)';
 el.style.transform='';
 el.classList.add('is-landing');
 window.setTimeout(()=>{ el.style.transition=''; el.classList.remove('is-landing'); },380);
}

export function KanbanBoard({label,busy,cards,columnName,onMove,renderOverlay,children}:{label:string,busy:boolean,cards:{id:number,title:string,column:string}[],columnName:(column:string)=>string,onMove:(card:number,column:string,before:number|null,from:{left:number,top:number}|null)=>Promise<boolean>|boolean,renderOverlay:(id:number)=>ReactNode,children:ReactNode}) {
 const {t}=useI18n();
 const [activeId,setActiveId]=useState<number|null>(null);
 const [place,setPlace]=useState<DropPlace>(nowhere);
 // The Card flying back to its place: it stays dimmed there until the carried copy arrives (design-reference: dragEnd).
 const [returning,setReturning]=useState<number|null>(null);
 const flyBack=useRef<number|null>(null);
 // The bars grow in when the board opens; the class that does it is gone 900ms later (design-reference: boardEnter).
 const [entering,setEntering]=useState(true);
 useEffect(()=>{ const timer=window.setTimeout(()=>setEntering(false),900); return ()=>clearTimeout(timer); },[]);
 // The pointer's own place, read on every move of the mouse or the finger rather than once per droppable, so the line
 // stands before the Card the carried one is really over (design-reference: dragMove's card under the pointer).
 const carrying=useRef<number|null>(null); const dropped=useRef<DropPlace>(nowhere); const shown=useRef<DropPlace>(nowhere);
 // A mouse drags after 5px. A finger must rest on the card for a moment first: a quicker swipe belongs to the browser and scrolls the board
 // (a pointer sensor starts on touch too, and the browser then cancels it with pointercancel at about 24px).
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:5}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:8}}));
 // dnd-kit scrolls a box by itself while the finger is near its edge, but while the finger crosses into another column it
 // can pair the board with the box it measured for the card's own list (the two lists of scrolling boxes update apart),
 // so a finger in the middle of the board scrolled it. A box scrolls by itself only while the finger is really in its
 // own edge bands, measured now, on an axis it can scroll.
 const finger=useRef<{x:number,y:number}|null>(null);
 // The place under a point: the column there, and the first Card whose middle is below it (null at the column's end).
 const placeAt=(x:number,y:number,id:number):DropPlace=>{
  const column=document.elementFromPoint(x,y)?.closest<HTMLElement>('#board-cols .col');
  if(!column) return nowhere;
  const under=[...column.querySelectorAll<HTMLElement>('.kcard[data-card-id]')].filter(card=>Number(card.dataset.cardId)!==id);
  const next=under.find(card=>{ const box=card.getBoundingClientRect(); return box.top+box.height/2>y; });
  return {column:column.getAttribute('data-column'),before:next?Number(next.dataset.cardId):null};
 };
 // After a drag, the release must not open the Card (design-reference: MOT.swallow): a click on a Card within 60ms of a
 // drag's end is swallowed.
 const swallowUntil=useRef(0);
 useEffect(()=>{
  const swallow=(event:MouseEvent)=>{ if(performance.now()>swallowUntil.current||!(event.target as Element|null)?.closest?.('.kcard')) return; swallowUntil.current=0; event.preventDefault(); event.stopPropagation(); };
  window.addEventListener('click',swallow,true);
  return ()=>window.removeEventListener('click',swallow,true);
 },[]);
 useEffect(()=>{
  // The place under the pointer, read again on every move of the mouse or the finger, and when the board or a column
  // scrolls under a resting pointer: the Cards move without a pointer move, and the line and the drop follow them.
  const read=()=>{ const at=finger.current; if(carrying.current===null||!at) return;
   const next=placeAt(at.x,at.y,carrying.current);
   if(next.column===shown.current.column&&next.before===shown.current.before) return;
   shown.current=next; dropped.current=next; setPlace(next);
  };
  const follow=(event:TouchEvent|MouseEvent)=>{ const at='touches' in event?event.touches[0]:event; if(!at) return; finger.current={x:at.clientX,y:at.clientY}; read(); };
  const options={capture:true,passive:true};
  window.addEventListener('touchstart',follow,options); window.addEventListener('touchmove',follow,options); window.addEventListener('mousedown',follow,options); window.addEventListener('mousemove',follow,options); window.addEventListener('scroll',read,options);
  return ()=>{ window.removeEventListener('touchstart',follow,options); window.removeEventListener('touchmove',follow,options); window.removeEventListener('mousedown',follow,options); window.removeEventListener('mousemove',follow,options); window.removeEventListener('scroll',read,options); };
 },[]);
 // While a Card is carried, each frame leans it with the pointer's speed and scrolls the columns near an edge of the
 // board (design-reference: dragMove's tilt, dragScroll). Read per frame, so a pointer that stands still lets the lean
 // settle back to 2deg.
 useEffect(()=>{
  if(activeId===null) return;
  let tilt=0,lastX=finger.current?.x??null,frame=0;
  const step=()=>{
   const at=finger.current; const reduced=prefersReducedMotion();
   if(at) {
    tilt=reduced||lastX===null?0:Math.max(-6,Math.min(6,tilt*0.6+(at.x-lastX)*0.45)); lastX=at.x;
    document.querySelector<HTMLElement>('.kcard--ghost')?.style.setProperty('--gw-tilt',`${tilt.toFixed(2)}deg`);
    const scroller=document.getElementById('board-cols');
    if(scroller) { const box=scroller.getBoundingClientRect(); const by=at.x<box.left+edge?-12:at.x>box.right-edge?12:0; if(by) scroller.scrollLeft+=by; }
   }
   frame=requestAnimationFrame(step);
  };
  frame=requestAnimationFrame(step);
  return ()=>cancelAnimationFrame(frame);
 },[activeId]);
 const canScroll=(element:Element)=>{
  // The board's own columns scroll sideways by the frame loop above, 12px a frame, as the reference's do.
  if(element.id==='board-cols') return false;
  if(!finger.current) return true;
  const box=element===document.scrollingElement?{left:0,top:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight}:element.getBoundingClientRect();
  // A box scrolls by itself on the axis it has the most room to scroll: the board runs sideways even when a runner lays
  // it a pixel shorter than its columns, and that spill must not hand a held Card the board's other axis (#249).
  const axes=scrollAxes({x:element.scrollWidth-element.clientWidth,y:element.scrollHeight-element.clientHeight});
  return inEdgeBand(box,finger.current,axes);
 };
 const columnFor=(id:string|number|undefined)=>id===undefined?undefined:String(id).startsWith('column:')?String(id).slice(7):cards.find(card=>card.id===Number(id))?.column;
 const putAway=()=>{ swallowUntil.current=performance.now()+60; carrying.current=null; dropped.current=nowhere; shown.current=nowhere; setActiveId(null); setPlace(nowhere); };
 // A Card let go over nothing, over its own place, or cancelled with Escape flies back to its place over 220ms and is
 // removed when it arrives; with reduced motion it is gone at once. A Card that moves is removed at once and lands.
 const returnHome=(id:number)=>{ if(prefersReducedMotion()) return; flyBack.current=id; setReturning(id); };
 const dropAnimation=({active,dragOverlay}:{active:{rect:{left:number,top:number}},dragOverlay:{node:HTMLElement}})=>{
  const id=flyBack.current; flyBack.current=null;
  const ghost=dragOverlay.node.querySelector<HTMLElement>('.kcard--ghost');
  if(id===null||!ghost) { setReturning(null); return; }
  const from=dragOverlay.node.getBoundingClientRect();
  ghost.style.transition='transform 220ms var(--gw-ease-out)';
  ghost.style.transform=`translate(${active.rect.left-from.left}px, ${active.rect.top-from.top}px)`;
  return new Promise<void>(done=>window.setTimeout(()=>{ setReturning(current=>current===id?null:current); done(); },230));
 };
 return <DndContext id="work-board" sensors={sensors} autoScroll={{canScroll}} onDragStart={({active})=>{ carrying.current=Number(active.id); setActiveId(Number(active.id)); }} onDragCancel={({active})=>{ returnHome(Number(active.id)); putAway(); }} onDragEnd={({active,over})=>{
  const id=Number(active.id); const card=cards.find(item=>item.id===id); const was=active.rect.current.translated;
  // The place under the pointer now, not the one the last pointer move named: a column or the board may have scrolled
  // since, moving the Cards under a resting finger (design-reference: dragEnd's card under the pointer).
  const at=finger.current?placeAt(finger.current.x,finger.current.y,id):dropped.current;
  putAway();
  if(!card||!over||!at.column) { returnHome(id); return; }
  // A drop on the Card's own place changes nothing (design-reference: dragEnd's sameSpot).
  if(!placeChanges(cards.filter(item=>item.column===at.column).map(item=>item.id),id,at.before)) { returnHome(id); return; }
  // The page lands the Card from where it was let go once the server took the place and the Card is drawn there: a
  // refused move stays where it is, with no motion to say it went.
  void onMove(id,at.column,at.before,was?{left:was.left,top:was.top}:null);
 }} accessibility={{screenReaderInstructions:{draggable:t('boardDragHint')},announcements:{onDragStart:({active})=>t('dragStarted',cards.find(card=>card.id===Number(active.id))?.title),onDragOver:({over})=>over?t('dragOver',columnName(columnFor(over.id)||'')):t('dragCancelled'),onDragEnd:({over})=>over?t('dragEnded',columnName(columnFor(over.id)||'')):t('dragCancelled'),onDragCancel:()=>t('dragCancelled')}}}>
  <DropMark.Provider value={{place,carrying:activeId!==null,returning}}>
   <div className={`board board-cols${entering?' board--enter':''}`} id="board-cols" aria-label={label} aria-busy={busy}>{children}</div>
   {/* The carried Card follows the pointer and never catches it, so the Card under the pointer is the one read (#174). */}
   <DragOverlay dropAnimation={dropAnimation} style={{pointerEvents:'none'}}>{activeId!==null?renderOverlay(activeId):null}</DragOverlay>
  </DropMark.Provider>
 </DndContext>;
}

// Which columns are in view: the position text, the two arrows, and an edge fade where more columns wait
// (design-reference: syncBoardNav, scrollBoard).
export function BoardPager() {
 const {t,language}=useI18n();
 const [view,setView]=useState({hidden:true,first:1,last:1,count:6,atStart:true,atEnd:true});
 useEffect(()=>{
  const scroller=document.getElementById('board-cols'); if(!scroller) return;
  const sync=()=>{
   const columns=[...scroller.querySelectorAll<HTMLElement>(':scope > .col')]; const box=scroller.getBoundingClientRect();
   const full=columns.map((column,index)=>{const r=column.getBoundingClientRect();return Math.min(r.right,box.right)-Math.max(r.left,box.left)>=r.width-2?index:-1;}).filter(index=>index>=0);
   const max=scroller.scrollWidth-scroller.clientWidth,position=Math.abs(scroller.scrollLeft);
   const atStart=position<=2,atEnd=position>=max-2;
   scroller.classList.toggle('has-more-start',max>2&&!atStart); scroller.classList.toggle('has-more-end',max>2&&!atEnd);
   setView({hidden:max<=2,first:(full[0]??0)+1,last:(full.at(-1)??0)+1,count:columns.length,atStart,atEnd});
  };
  sync();
  scroller.addEventListener('scroll',sync,{passive:true}); window.addEventListener('resize',sync);
  const observer=new ResizeObserver(sync); observer.observe(scroller);
  return ()=>{scroller.removeEventListener('scroll',sync);window.removeEventListener('resize',sync);observer.disconnect();};
 },[]);
 const scroll=(direction:'prev'|'next')=>{
  const scroller=document.getElementById('board-cols'); if(!scroller) return;
  const columns=[...scroller.querySelectorAll<HTMLElement>(':scope > .col')]; const target=columns[direction==='next'?view.last:view.first-2]; if(!target) return;
  const box=scroller.getBoundingClientRect(),r=target.getBoundingClientRect(),pad=parseFloat(getComputedStyle(scroller).paddingInlineStart)||0,rtl=language==='ar';
  const delta=(direction==='next')===rtl?r.left-(box.left+pad):r.right-(box.right-pad);
  scroller.scrollBy({left:delta,behavior:prefersReducedMotion()?'auto':'smooth'});
 };
 return <div className="board-nav" role="group" aria-label={t('boardColumnsNav')} hidden={view.hidden}>
  <span className="board-nav__pos num" aria-live="polite">{view.hidden?t('boardColumnsCount',view.count):t('boardColumnsRange',view.first,view.last,view.count)}</span>
  <button type="button" className="circle-btn" disabled={view.atStart} aria-label={t('boardPrevColumns')} aria-controls="board-cols" onClick={()=>scroll('prev')}><BoardIcon name="back"/></button>
  <button type="button" className="circle-btn" disabled={view.atEnd} aria-label={t('boardNextColumns')} aria-controls="board-cols" onClick={()=>scroll('next')}><BoardIcon name="forward"/></button>
 </div>;
}
