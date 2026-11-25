'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark, createCodeBlockCommand, insertHrCommand, insertImageCommand, liftListItemCommand, sinkListItemCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInHeadingCommand, wrapInOrderedListCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload';
import { block, BlockProvider } from '@milkdown/kit/plugin/block';
import { $prose, callCommand, replaceAll } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';

// The description written where it is read (#680, spec #668; design-reference-card: deEdit, the "/" menu, the phone's
// bar of blocks). Its JavaScript is loaded only when a description is edited (app/description-place.tsx).
//
// The editor weighed (scratchpad notes kept in the ticket): Milkdown kit 7 (144 KB gzipped for core, CommonMark, GFM,
// history, listener, slash), Tiptap 3 with @tiptap/markdown (162 KB, Markdown through a conversion that renders inline
// HTML unless overridden), Lexical (103 KB, Markdown only through hand-written transformers, tables included), BlockNote
// (MPL-2.0, larger, Markdown lossy by its own documentation), MDXEditor (Lexical plus CodeMirror and form libraries) and
// CodeMirror or a plain text area (exact text but no drawn blocks, no tick, no "/" blocks). Milkdown is chosen: Markdown
// is its own format (remark reads it and writes it back), so what is written saves as Markdown and reads back the same,
// raw HTML stays its own text, and it is the smallest maintained editor that draws every block the stories ask for.
// Its menus are this app's own.

// What a save answers: the text now saved and its version, and whether it was merged with a save made meanwhile.
export type DescriptionSaved={version:number,body:string,merged:boolean,conflicted:boolean}|{error:string};
export type PictureUploaded={url:string,name:string}|{error:string};
type Callable={id:string,name:string,kind:'person'|'agent'};
type Choice={key:string,label:string,icon:ShellIconName};
type Pop={kind:'slash'|'mention',query:string,from:number,to:number,top:number,left:number,index:number}|null;

const popKey=new PluginKey('description-pop');

// Each line in its own direction, its marker on its own start (#679's reading, kept while writing).
const directions=$prose(()=>new Plugin({props:{decorations:state=>{
 const found:Decoration[]=[];
 state.doc.descendants((node,pos)=>{ if(node.isTextblock||node.type.name==='list_item'||node.type.name==='table_cell'||node.type.name==='table_header') found.push(Decoration.node(pos,pos+node.nodeSize,{dir:node.type.name==='code_block'?'ltr':'auto'})); return true; });
 return DecorationSet.create(state.doc,found);
}}}));

// A to-do's box is pressed while writing too: on its start, outside the text.
const boxes=$prose(()=>new Plugin({props:{handleClickOn:(view,_pos,node,nodePos,event)=>{
 if(node.type.name!=='list_item'||node.attrs.checked==null) return false;
 const dom=view.nodeDOM(nodePos) as HTMLElement|null; if(!dom) return false;
 const box=dom.getBoundingClientRect(); const rtl=getComputedStyle(dom).direction==='rtl';
 const fromStart=rtl?box.right-event.clientX:event.clientX-box.left;
 if(fromStart>26) return false;
 view.dispatch(view.state.tr.setNodeMarkup(nodePos,undefined,{...node.attrs,checked:!node.attrs.checked}));
 return true;
}}}));

// The block holding the cursor, as its list item when it is in a list, so moving a line moves a to-do with its children.
function movable(state:EditorState) {
 const {$from}=state.selection;
 for(let depth=$from.depth;depth>0;depth--) { const node=$from.node(depth); if(node.type.name==='list_item'||depth===1) return {depth,node,pos:$from.before(depth)}; }
 return null;
}
// Alt+Shift+Up and Down move the line, with what is nested under it, among its neighbours.
function moveLine(view:EditorView,step:-1|1) {
 const found=movable(view.state); if(!found) return false;
 const $pos=view.state.doc.resolve(found.pos); const index=$pos.index(); const parent=$pos.parent;
 const other=index+step; if(other<0||other>=parent.childCount) return true;
 const neighbour=parent.child(other); const tr=view.state.tr;
 const offset=view.state.selection.from-found.pos;
 if(step===-1) { const start=found.pos-neighbour.nodeSize; tr.delete(found.pos,found.pos+found.node.nodeSize).insert(start,found.node); tr.setSelection(TextSelection.near(tr.doc.resolve(start+offset))); }
 else { const start=found.pos; tr.delete(start,start+found.node.nodeSize).insert(start+neighbour.nodeSize,found.node); tr.setSelection(TextSelection.near(tr.doc.resolve(start+neighbour.nodeSize+offset))); }
 view.dispatch(tr.scrollIntoView()); return true;
}

// `draft`: the New card form's description (#683), kept in the form until the Card is made: no save line, no Done and
// no picture (a picture is stored in a Card's own folder).
export default function DescriptionEditor({body,version,slug,company,card,people,save,upload:send,onDone,draft=false,label}:{body:string,version:number,slug:string,company:string,card:number,people:Callable[],
 save:(body:string,base:number)=>Promise<DescriptionSaved>,upload:(form:FormData)=>Promise<PictureUploaded>,onDone:()=>void,draft?:boolean,label?:string}) {
 const {t}=useI18n(); const id=useId();
 const root=useRef<HTMLDivElement>(null); const grip=useRef<HTMLDivElement>(null); const editor=useRef<Editor|null>(null); const picture=useRef<HTMLInputElement>(null);
 const [pop,setPop]=useState<Pop>(null); const popRef=useRef<Pop>(null);
 useEffect(()=>{ popRef.current=pop; },[pop]);
 const [state,setState]=useState<'saved'|'saving'|'merged'|'both'|'error'>('saved'); const [said,setSaid]=useState('');
 const [phone,setPhone]=useState(false);
 // The save queue: one save in flight; what was typed meanwhile is saved after it, over the version it answered.
 const base=useRef(version); const shown=useRef(body); const pending=useRef<string|null>(null); const flight=useRef(false); const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const latest=useRef({save,send,t});
 useEffect(()=>{ latest.current={save,send,t}; });

 const flush=async()=>{
  if(flight.current||pending.current==null) return;
  const text=pending.current; pending.current=null; flight.current=true; setState('saving');
  let answer:DescriptionSaved; try { answer=await latest.current.save(text,base.current); } catch { answer={error:latest.current.t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
  flight.current=false;
  if('error' in answer) { setState('error'); setSaid(answer.error); pending.current=pending.current??text; return; }
  base.current=answer.version; shown.current=answer.body; setSaid('');
  // Merged with a save made meanwhile: the editor shows the merged text, unless more was typed since, which the next
  // save merges in turn.
  if(answer.merged&&pending.current==null&&answer.body!==text) editor.current?.action(replaceAll(answer.body,true));
  setState(answer.conflicted?'both':answer.merged?'merged':'saved');
  if(pending.current!=null) void flush();
 };
 // Milkdown ends what it writes with a line break; the description is kept without one.
 const changed=(written:string)=>{ const markdown=written.replace(/\n+$/,''); if(markdown===shown.current&&pending.current==null) return; pending.current=markdown; if(timer.current) clearTimeout(timer.current); timer.current=setTimeout(()=>void flush(),700); };

 const run=(command:Parameters<typeof callCommand>[0],payload?:unknown)=>{ editor.current?.action(callCommand(command,payload)); editor.current?.action(ctx=>ctx.get(editorViewCtx).focus()); };
 const todo=()=>{ editor.current?.action(ctx=>{ const view=ctx.get(editorViewCtx); callCommand(wrapInBulletListCommand.key)(ctx);
  const {$from}=view.state.selection; for(let depth=$from.depth;depth>0;depth--) { const node=$from.node(depth); if(node.type.name==='list_item') { view.dispatch(view.state.tr.setNodeMarkup($from.before(depth),undefined,{...node.attrs,checked:false})); break; } }
  view.focus(); }); };
 // One block put where the cursor is, by its key: what the "/" menu and the phone's bar both run.
 const act=(key:string)=>{
  if(key==='h1') run(wrapInHeadingCommand.key,1); else if(key==='h2') run(wrapInHeadingCommand.key,2);
  else if(key==='ul') run(wrapInBulletListCommand.key); else if(key==='ol') run(wrapInOrderedListCommand.key); else if(key==='todo') todo();
  else if(key==='quote') run(wrapInBlockquoteCommand.key); else if(key==='code') run(createCodeBlockCommand.key); else if(key==='table') run(insertTableCommand.key,{row:3,col:2});
  else if(key==='image') picture.current?.click(); else if(key==='hr') run(insertHrCommand.key);
  else if(key==='in') run(sinkListItemCommand.key); else if(key==='out') run(liftListItemCommand.key);
 };
 const blocks:Choice[]=[
  {key:'h1',label:t('deBlockHeading'),icon:'heading'},{key:'h2',label:t('deBlockSubheading'),icon:'heading'},{key:'ul',label:t('deBlockList'),icon:'list'},
  {key:'ol',label:t('deBlockNumbered'),icon:'listNumbered'},{key:'todo',label:t('deBlockTodo'),icon:'todo'},{key:'quote',label:t('deBlockQuote'),icon:'quote'},
  {key:'code',label:t('deBlockCode'),icon:'code'},{key:'table',label:t('deBlockTable'),icon:'table'},...(draft?[]:[{key:'image',label:t('deBlockImage'),icon:'image' as const}]),{key:'hr',label:t('deBlockDivider'),icon:'divider'},
 ];
 const choices=(current:Pop):Choice[]=>{ if(!current) return [];
  const q=current.query.toLowerCase();
  if(current.kind==='slash') return blocks.filter(item=>!q||item.label.toLowerCase().includes(q)||item.key.startsWith(q));
  return people.filter(person=>!q||person.name.toLowerCase().includes(q)).slice(0,8).map(person=>({key:`${person.kind}:${person.id}`,label:person.name,icon:person.kind==='agent'?'bot':'user'}));
 };
 // Choosing from a menu first takes away what was typed to open it ("/he" or "@Sa").
 const choose=(current:Pop,choice:Choice)=>{ if(!current) return; setPop(null);
  editor.current?.action(ctx=>{ const view=ctx.get(editorViewCtx);
   if(current.kind==='mention') { view.dispatch(view.state.tr.insertText(`@${choice.label} `,current.from,current.to)); view.focus(); return; }
   view.dispatch(view.state.tr.delete(current.from,current.to)); });
  if(current.kind==='slash') act(choice.key); };

 useEffect(()=>{
  const element=root.current; if(!element) return;
  const media=window.matchMedia('(pointer: coarse), (max-width: 640px)'); const fit=()=>setPhone(media.matches); fit(); media.addEventListener('change',fit);
  // "/" at a line's start opens the blocks; "@" opens the people and Agents to call; arrows, Enter and Escape drive them.
  const menus=$prose(()=>new Plugin({key:popKey,view:()=>({update:view=>{
    const {$from,empty}=view.state.selection; if(!empty) { setPop(null); return; }
    const before=$from.parent.textBetween(0,$from.parentOffset,undefined,'￼');
    const slash=/^\/([^\s/]*)$/.exec(before); const mention=/(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    const found=slash?{kind:'slash' as const,query:slash[1]}:mention?{kind:'mention' as const,query:mention[1]}:null;
    if(!found) { if(popRef.current) setPop(null); return; }
    const length=found.query.length+1; const at=view.coordsAtPos($from.pos); const frame=element.getBoundingClientRect();
    setPop(prev=>({...found,from:$from.pos-length,to:$from.pos,top:at.bottom-frame.top+4,left:at.left-frame.left,index:prev&&prev.kind===found.kind?prev.index:0}));
   }}),props:{handleKeyDown:(view,event)=>{
    if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')) return moveLine(view,event.key==='ArrowUp'?-1:1);
    const current=popRef.current; if(!current) return false; const list=choices(current);
    if(event.key==='Escape') { setPop(null); return true; }
    if(!list.length) return false;
    if(event.key==='ArrowDown'||event.key==='ArrowUp') { setPop({...current,index:(current.index+(event.key==='ArrowDown'?1:list.length-1))%list.length}); return true; }
    if(event.key==='Enter'||event.key==='Tab') { choose(current,list[Math.min(current.index,list.length-1)]); return true; }
    return false;
   }}}));
  const made=Editor.make().config(ctx=>{
   ctx.set(rootCtx,element); ctx.set(defaultValueCtx,body);
   ctx.get(listenerCtx).markdownUpdated((_ctx,markdown)=>changed(markdown));
   ctx.update(uploadConfig.key,prev=>({...prev,uploader:async(files,schema)=>{
    const nodes:ProseNode[]=[];
    for(const file of [...files]) { if(!file.type.startsWith('image/')) continue;
     const form=new FormData(); for(const [key,value] of Object.entries({slug,company,card:String(card)})) form.set(key,value); form.set('files',file);
     const answer=await latest.current.send(form); if('error' in answer) { setSaid(answer.error); continue; }
     const image=schema.nodes.image.createAndFill({src:answer.url,alt:answer.name}); if(image) nodes.push(image); }
    return nodes;
   }}));
  }).use(commonmark).use(gfm).use(history).use(listener).use(clipboard).use(upload).use(block).use(directions).use(boxes).use(menus);
  let gone=false; let provider:BlockProvider|null=null;
  void made.create().then(instance=>{ if(gone) { void instance.destroy(); return; } editor.current=instance;
   if(grip.current) instance.action(ctx=>{ provider=new BlockProvider({ctx,content:grip.current!,getOffset:()=>8,getPlacement:()=>document.documentElement.dir==='rtl'?'right':'left'}); provider.update(); });
   if(!draft) instance.action(ctx=>ctx.get(editorViewCtx).focus()); });
  return ()=>{ gone=true; media.removeEventListener('change',fit); provider?.destroy(); if(timer.current) clearTimeout(timer.current); void flush(); void editor.current?.destroy(); editor.current=null; };
  // The editor is made once for the description it opened on; later texts reach it through the save answers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);

 const list=choices(pop);
 const status:Record<typeof state,ReactNode>={saved:t('deSaved'),saving:t('deSaving'),merged:t('deMerged'),both:t('deBothKept'),error:said};
 const bar:Choice[]=[...blocks.filter(item=>['h1','ul','todo','quote','code','image'].includes(item.key)),{key:'in',label:t('deIndent'),icon:'indent'},{key:'out',label:t('deOutdent'),icon:'outdent'}];
 return <div className="de-wrap">
  <div ref={root} className="de de--edit" data-placeholder={t('dePlaceholder')} aria-label={label??t('cwDescription')}/>
  <div ref={grip} className="de-grip" aria-hidden="true" title={t('deDragLine')}><ShellIcon name="grip"/></div>
  {pop&&list.length>0&&<div className="menu de-pop" role="listbox" id={`${id}-pop`} aria-label={pop.kind==='slash'?t('deBlocks'):t('deCall')} style={{top:pop.top,insetInlineStart:pop.left}}>
   {list.map((item,index)=><button key={item.key} type="button" role="option" aria-selected={index===pop.index} className={`menu__item${index===pop.index?' is-active':''}`}
    onMouseDown={event=>{ event.preventDefault(); choose(pop,item); }}><ShellIcon name={item.icon}/><span className="menu__t"><bdi dir="auto">{item.label}</bdi></span></button>)}
  </div>}
  {phone&&<div className="de-bar" role="toolbar" aria-label={t('deBlocks')}>{bar.map(item=><button key={item.key} type="button" className="ib ib--sm" aria-label={item.label} data-tip={item.label}
   onMouseDown={event=>event.preventDefault()} onClick={()=>act(item.key)}><ShellIcon name={item.icon}/></button>)}</div>}
  <input ref={picture} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label={t('deBlockImage')} onChange={event=>{
   const file=event.target.files?.[0]; event.target.value=''; if(!file) return;
   const form=new FormData(); for(const [key,value] of Object.entries({slug,company,card:String(card)})) form.set(key,value); form.set('files',file);
   void latest.current.send(form).then(answer=>{ if('error' in answer) { setSaid(answer.error); return; } run(insertImageCommand.key,{src:answer.url,alt:answer.name}); }); }}/>
  {!draft&&<div className="de-foot"><span className="de-status" role="status" aria-live="polite">{state!=='saved'||said?<>{state==='both'&&<ShellIcon name="alert"/>}{status[state]}</>:t('deSaved')}</span>
   <button type="button" className="btn btn--secondary btn--sm" onClick={()=>{ void flush(); onDone(); }}>{t('deDone')}</button></div>}
 </div>;
}
