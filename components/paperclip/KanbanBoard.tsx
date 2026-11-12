'use client';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useI18n } from '@/lib/i18n-client';
import { Circle } from 'lucide-react';
import { Card } from './ui/card';
import { cn } from './utils';

// The gtmworks stage order maps onto Paperclip's existing neutral/status tints.
const tones=[
 {header:'text-muted-foreground',body:'bg-muted/30 ring-1 ring-inset ring-border/50'},
 {header:'text-amber-700 dark:text-amber-300',body:'bg-amber-50/45 ring-1 ring-inset ring-amber-500/15 dark:bg-amber-950/15'},
 {header:'text-blue-700 dark:text-blue-300',body:'bg-blue-50/45 ring-1 ring-inset ring-blue-500/15 dark:bg-blue-950/15'},
 {header:'text-violet-700 dark:text-violet-300',body:'bg-violet-50/45 ring-1 ring-inset ring-violet-500/15 dark:bg-violet-950/15'},
 {header:'text-violet-700 dark:text-violet-300',body:'bg-violet-50/45 ring-1 ring-inset ring-violet-500/15 dark:bg-violet-950/15'},
 {header:'text-green-700 dark:text-green-300',body:'bg-green-50/45 ring-1 ring-inset ring-green-500/15 dark:bg-green-950/15'},
 {header:'text-blue-700 dark:text-blue-300',body:'bg-blue-50/45 ring-1 ring-inset ring-blue-500/15 dark:bg-blue-950/15'},
 {header:'text-green-700 dark:text-green-300',body:'bg-green-50/45 ring-1 ring-inset ring-green-500/15 dark:bg-green-950/15'},
 {header:'text-muted-foreground/80',body:'bg-muted/25 ring-1 ring-inset ring-border/50'},
];
export function KanbanColumn({title,count,index,stageId,cardIds,children,...props}:{title:string,count:number,index:number,stageId:number,cardIds:number[],children:ReactNode}&ComponentProps<'div'>) {
 const tone=tones[index%tones.length];
 const {setNodeRef,isOver}=useDroppable({id:`stage:${stageId}`});
 return <div {...props} className="column flex flex-col shrink-0 min-w-(--sz-260px) w-(--sz-260px)">
  <h3 className={cn('flex items-center gap-2 px-3 py-2 mb-1',tone.header)}><Circle className="h-3.5 w-3.5" aria-hidden="true"/><span dir="auto">{title}</span><span className="count ms-auto text-xs tabular-nums">{count}</span></h3>
  <div ref={setNodeRef} className={cn('column-body flex-1 min-h-(--sz-120px) rounded-md p-2 space-y-1 transition-colors',isOver?'bg-accent/40 ring-1 ring-primary/20':tone.body)}><SortableContext items={cardIds} strategy={verticalListSortingStrategy}>{children}</SortableContext></div>
 </div>;
}
export function KanbanCard({children,id,isOverlay=false,...props}:Omit<ComponentProps<'div'>,'id'>&{id:number,isOverlay?:boolean}) {
 const {t}=useI18n();
 const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id,attributes:{roleDescription:t('card')}});
 return <Card {...props} ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} {...attributes} {...listeners} data-card-id={isOverlay?undefined:id} className={cn('card block cursor-grab active:cursor-grabbing transition-shadow p-2.5',isDragging&&!isOverlay?'opacity-30':'',isOverlay?'shadow-lg ring-1 ring-primary/20':'hover:shadow-sm')}>
  <div className="card-id text-xs text-muted-foreground font-mono shrink-0" dir="ltr">#{id}</div>{children}
 </Card>;
}

export function KanbanBoard({label,busy,cards,stages,onMove,renderOverlay,children}:{label:string,busy:boolean,cards:{id:number,title:string,stage_id:number}[],stages:{id:number,name:string}[],onMove:(card:number,stage:number)=>void,renderOverlay:(id:number)=>ReactNode,children:ReactNode}) {
 const {t}=useI18n();
 const [activeId,setActiveId]=useState<number|null>(null);
 // A mouse drags after 5px. A finger must rest on the card for a moment first: a quicker swipe belongs to the browser and scrolls the board
 // (a pointer sensor starts on touch too, and the browser then cancels it with pointercancel at about 24px).
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:5}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:8}}));
 const stageFor=(id:string|number)=>String(id).startsWith('stage:')?Number(String(id).slice(6)):cards.find(card=>card.id===Number(id))?.stage_id;
 const stageName=(id:string|number)=>stages.find(stage=>stage.id===stageFor(id))?.name;
 return <DndContext sensors={sensors} onDragStart={({active})=>setActiveId(Number(active.id))} onDragCancel={()=>setActiveId(null)} onDragEnd={({active,over})=>{
  setActiveId(null);
  if(!over) return;
  const stage=stageFor(over.id),card=cards.find(card=>card.id===Number(active.id));
  if(card&&stage!==undefined&&stage!==card.stage_id) onMove(card.id,stage);
 }} accessibility={{screenReaderInstructions:{draggable:t('dragInstructions')},announcements:{onDragStart:({active})=>t('dragStarted',cards.find(card=>card.id===Number(active.id))?.title),onDragOver:({over})=>over?t('dragOver',stageName(over.id)):t('dragCancelled'),onDragEnd:({over})=>over?t('dragEnded',stageName(over.id)):t('dragCancelled'),onDragCancel:()=>t('dragCancelled')}}}>
  <div className="board" aria-label={label} aria-busy={busy}>{children}</div>
  <DragOverlay>{activeId!==null?renderOverlay(activeId):null}</DragOverlay>
 </DndContext>;
}
