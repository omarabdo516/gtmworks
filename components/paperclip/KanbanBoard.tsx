'use client';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useI18n } from '@/lib/i18n-client';
import { BoardIcon } from '@/components/board-icon';
import '@/app/board.css';

// The approved design's board (design-reference: #board-cols, .col, .kcard). A card is carried to another column with
// the mouse or a finger (dnd-kit); the keyboard moves it with Shift and the arrows (handled by the card's page).
export function KanbanColumn({column,name,count,waiting=false,head,children,...props}:{column:string,name:string,count:number,waiting?:boolean,head?:ReactNode,children:ReactNode}&ComponentProps<'section'>) {
 const {setNodeRef,isOver,active}=useDroppable({id:`column:${column}`});
 const blocked=isOver&&active?.data.current?.blocked?.(column);
 return <section ref={setNodeRef} {...props} data-column={column} aria-labelledby={`col-${column}`} className={`col${waiting?' col--waiting':''}${isOver?(blocked?' is-blocked':' is-over'):''}`}>
  <div className="col__head">{waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}<h2 className="col__name" id={`col-${column}`}>{name}</h2><span className={`col__count num${waiting?' approval-count':''}`}>{count}</span>{head}</div>
  <div className="col__body">{children}</div>
 </section>;
}

export function KanbanCard({children,id,column,isOverlay=false,disabled=false,blocked,className='',...props}:Omit<ComponentProps<'div'>,'id'>&{id:number,column:string,isOverlay?:boolean,disabled?:boolean,blocked?:(to:string)=>boolean}) {
 const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id,disabled:disabled||isOverlay,data:{column,blocked}});
 // The card's link is the one stop for the keyboard; the draggable box itself is not a second one.
 const {role:_role,tabIndex:_tab,'aria-describedby':_hint,'aria-roledescription':_kind,...rest}=attributes;
 void _role; void _tab; void _hint; void _kind;
 return <div {...props} ref={isOverlay?undefined:setNodeRef} {...(isOverlay?{}:rest)} {...(isOverlay?{}:listeners)} data-card-id={isOverlay?undefined:id} aria-hidden={isOverlay||undefined}
  className={`kcard card ${className}${isDragging&&!isOverlay?' is-drag-src':''}${isOverlay?' kcard--ghost':''}`}>{children}</div>;
}

export function KanbanBoard({label,busy,cards,columnName,onMove,renderOverlay,children}:{label:string,busy:boolean,cards:{id:number,title:string,column:string}[],columnName:(column:string)=>string,onMove:(card:number,column:string)=>void,renderOverlay:(id:number)=>ReactNode,children:ReactNode}) {
 const {t}=useI18n();
 const [activeId,setActiveId]=useState<number|null>(null);
 // A mouse drags after 5px. A finger must rest on the card for a moment first: a quicker swipe belongs to the browser and scrolls the board
 // (a pointer sensor starts on touch too, and the browser then cancels it with pointercancel at about 24px).
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:5}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:8}}));
 const columnFor=(id:string|number|undefined)=>id===undefined?undefined:String(id).startsWith('column:')?String(id).slice(7):cards.find(card=>card.id===Number(id))?.column;
 return <DndContext id="work-board" sensors={sensors} onDragStart={({active})=>setActiveId(Number(active.id))} onDragCancel={()=>setActiveId(null)} onDragEnd={({active,over})=>{
  setActiveId(null);
  const column=columnFor(over?.id),card=cards.find(card=>card.id===Number(active.id));
  if(card&&column) onMove(card.id,column);
 }} accessibility={{screenReaderInstructions:{draggable:t('boardDragHint')},announcements:{onDragStart:({active})=>t('dragStarted',cards.find(card=>card.id===Number(active.id))?.title),onDragOver:({over})=>over?t('dragOver',columnName(columnFor(over.id)||'')):t('dragCancelled'),onDragEnd:({over})=>over?t('dragEnded',columnName(columnFor(over.id)||'')):t('dragCancelled'),onDragCancel:()=>t('dragCancelled')}}}>
  <div className="board board-cols" id="board-cols" aria-label={label} aria-busy={busy}>{children}</div>
  <DragOverlay dropAnimation={null}>{activeId!==null?renderOverlay(activeId):null}</DragOverlay>
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
  scroller.scrollBy({left:delta,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 };
 return <div className="board-nav" role="group" aria-label={t('boardColumnsNav')} hidden={view.hidden}>
  <span className="board-nav__pos num" aria-live="polite">{view.hidden?t('boardColumnsCount',view.count):t('boardColumnsRange',view.first,view.last,view.count)}</span>
  <button type="button" className="circle-btn" disabled={view.atStart} aria-label={t('boardPrevColumns')} aria-controls="board-cols" onClick={()=>scroll('prev')}><BoardIcon name="back"/></button>
  <button type="button" className="circle-btn" disabled={view.atEnd} aria-label={t('boardNextColumns')} aria-controls="board-cols" onClick={()=>scroll('next')}><BoardIcon name="forward"/></button>
 </div>;
}
