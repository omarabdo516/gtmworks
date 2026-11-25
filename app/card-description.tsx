'use client';
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PhrasingContent, RootContent, TableRow } from 'mdast';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { companyImage, parseDescription, safeHref, todoItems } from '@/lib/card-description.mjs';

// A Card's description read drawn (#679, spec #668; design-reference-card: deParse/deHTML/deReadHTML). One block per
// line, each in its own direction with its marker on its own start; the count of each to-do list sits above it; a to-do
// is ticked while reading, with the mouse, a touch or the keyboard, by its own operation. Raw HTML is drawn as its text;
// a link leads only to a web page, an email address or a page of this app; a picture shows only from the Company's own
// storage. A long description folds after about twelve lines.

// What a tick answers: the item ticked (where it now is), unchanged, or refused because the item changed or is gone.
export type TickResult={ticked:true}|{changed:false}|{gone:true}|{error:string};
export type TickTodo=(line:number,item:string,done:boolean)=>Promise<TickResult>;

type Inline=PhrasingContent[];
type Block={key:string,level:number,quote:boolean}&(
 {t:'h1'|'h2'|'p'|'ul',inline:Inline}|{t:'ol',inline:Inline,n:number}|{t:'todo',inline:Inline,line:number,done:boolean}|
 {t:'code',value:string}|{t:'table',rows:Inline[][],align:(string|null)[]}|{t:'img',url:string,alt:string}|{t:'hr'}|{t:'text',value:string});

const textOf=(nodes:Inline):string=>nodes.map(node=>'value' in node?String(node.value):'children' in node?textOf(node.children as Inline):'alt' in node?String(node.alt||''):'').join('');

// The tree as lines, the prototype's blocks: a list item is a line at its depth, and what is under it follows it one
// level in; a quote's lines carry the quote.
function blocksOf(nodes:RootContent[],level=0,quote=false,out:Block[]=[]):Block[] {
 for(const node of nodes) {
  const key=`${node.position?.start.line??out.length}:${node.position?.start.column??0}:${out.length}`;
  if(node.type==='heading') out.push({key,level,quote,t:node.depth===1?'h1':'h2',inline:node.children});
  else if(node.type==='paragraph') {
   const only=node.children.length===1&&node.children[0].type==='image'?node.children[0]:null;
   if(only&&only.type==='image') out.push({key,level,quote,t:'img',url:only.url,alt:only.alt||''});
   else out.push({key,level,quote,t:'p',inline:node.children});
  }
  else if(node.type==='list') node.children.forEach((item,index)=>{
   const [first,...rest]=item.children; const inline=first?.type==='paragraph'?first.children:[];
   const itemKey=`${item.position?.start.line??out.length}:${item.position?.start.column??0}:${out.length}`;
   if(typeof item.checked==='boolean') out.push({key:itemKey,level,quote,t:'todo',inline,line:item.position?.start.line??0,done:item.checked});
   else if(node.ordered) out.push({key:itemKey,level,quote,t:'ol',inline,n:(node.start??1)+index});
   else out.push({key:itemKey,level,quote,t:'ul',inline});
   blocksOf(first?.type==='paragraph'?rest:item.children,level+1,quote,out);
  });
  else if(node.type==='blockquote') blocksOf(node.children,level,true,out);
  else if(node.type==='code') out.push({key,level,quote,t:'code',value:node.value});
  else if(node.type==='table') out.push({key,level,quote,t:'table',rows:node.children.map((row:TableRow)=>row.children.map(cell=>cell.children)),align:node.align??[]});
  else if(node.type==='thematicBreak') out.push({key,level,quote,t:'hr'});
  else if(node.type==='html') out.push({key,level,quote,t:'text',value:node.value});
  else if(node.type==='definition'||node.type==='footnoteDefinition') continue;
  else if('children' in node) blocksOf(node.children as RootContent[],level,quote,out);
  else if('value' in node) out.push({key,level,quote,t:'text',value:String(node.value)});
 }
 return out;
}

// A to-do list's count, above its first item: consecutive to-dos, with anything nested under them.
function runsOf(blocks:Block[]) {
 const runs=new Map<number,{done:number,total:number}>(); let current:{done:number,total:number}|null=null; let base=0;
 blocks.forEach((block,index)=>{
  if(block.t==='todo'&&(!current||block.level>=base)) { if(!current) { current={done:0,total:0}; base=block.level; runs.set(index,current); } current.total+=1; if(block.done) current.done+=1; return; }
  if(current&&block.level>base) return;
  current=null;
 });
 return runs;
}

function Phrasing({nodes,slug}:{nodes:Inline,slug:string}):ReactNode {
 return nodes.map((node,index)=>{
  switch(node.type) {
   case 'text': return node.value;
   case 'emphasis': return <em key={index}><Phrasing nodes={node.children} slug={slug}/></em>;
   case 'strong': return <strong key={index}><Phrasing nodes={node.children} slug={slug}/></strong>;
   case 'delete': return <del key={index}><Phrasing nodes={node.children} slug={slug}/></del>;
   case 'inlineCode': return <code key={index} className="de-c" dir="ltr">{node.value}</code>;
   case 'break': return <br key={index}/>;
   case 'html': return node.value;
   case 'link': { const href=safeHref(node.url); const inner=<Phrasing nodes={node.children} slug={slug}/>;
    if(!href) return <span key={index}>{inner}</span>;
    const away=!href.startsWith('/');
    return <a key={index} className="de-a" href={href} {...(away?{target:'_blank',rel:'noopener noreferrer nofollow'}:{})}>{inner}</a>; }
   case 'image': { const src=companyImage(node.url,slug);
    return src?<img key={index} className="de-img de-img--inline" src={src} alt={node.alt||''} loading="lazy"/>:<span key={index} className="de-img-out">{node.alt||node.url}</span>; }
   case 'linkReference': return <span key={index}><Phrasing nodes={node.children} slug={slug}/></span>;
   case 'imageReference': return node.alt||'';
   case 'footnoteReference': return `[^${node.label??node.identifier}]`;
   default: return 'children' in node?<Phrasing key={index} nodes={(node as {children:Inline}).children} slug={slug}/>:null;
  }
 });
}

export function CardDescription({body,slug,canTick,tick}:{body:string,slug:string,canTick:boolean,tick?:TickTodo}) {
 const {t}=useI18n(); const id=useId();
 // A tick shows at once; the description the board reads next replaces it (and an answer that refused it puts it back).
 const [ticked,setTicked]=useState<Record<number,boolean>>({}); const [said,setSaid]=useState('');
 const [read,setRead]=useState(body); if(read!==body) { setRead(body); setTicked({}); }
 const items=new Map(todoItems(body).map(item=>[item.line,item]));
 const blocks=blocksOf(parseDescription(body).children); const runs=runsOf(blocks);
 const box=useRef<HTMLDivElement>(null); const [fold,setFold]=useState<'none'|'folded'|'open'>('none');
 useLayoutEffect(()=>{ const element=box.current; if(!element||fold==='open') return;
  const line=parseFloat(getComputedStyle(element).lineHeight)||25; const cap=Math.round(line*12);
  element.style.setProperty('--de-cap',`${cap}px`);
  setFold(element.scrollHeight>cap+line*2?'folded':'none'); },[body,fold]);
 if(!blocks.length) return null;
 const press=async(line:number,done:boolean)=>{ const item=items.get(line); if(!item||!tick) return;
  setTicked(now=>({...now,[line]:done})); setSaid('');
  let answer:TickResult; try { answer=await tick(line,item.item,done); } catch { answer={error:t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
  if('error' in answer||'gone' in answer) { setTicked(now=>{ const next={...now}; delete next[line]; return next; }); setSaid('gone' in answer?t('deTodoChanged'):answer.error); } };
 let todo=-1;
 return <>
  <div ref={box} id={`${id}-de`} className={`de de--read${fold==='folded'?' is-fold':''}`}>
   {blocks.map((block,index)=>{
    const run=runs.get(index);
    const count=run&&<div className={`de-prog${run.done===run.total?' is-all':''}`} dir="auto"><span className="de-prog__t num"><bdi dir="ltr">{run.done}/{run.total}</bdi><span className="sr-only"> {t('deTodosDone')}</span></span><span className="bar de-prog__bar" aria-hidden="true"><span className="bar__fill" style={{transform:`scaleX(${run.total?run.done/run.total:0})`}}/></span></div>;
    const attrs={'data-t':block.t,'data-l':Math.min(block.level,4),'data-q':block.quote?'1':undefined,className:'de-b'};
    let line:ReactNode;
    if(block.t==='hr') line=<div {...attrs}><hr className="de-hr"/></div>;
    else if(block.t==='img') { const src=companyImage(block.url,slug);
     line=<div {...attrs} dir="auto">{src?<figure className="de-fig"><img className="de-img" src={src} alt={block.alt} loading="lazy"/>{block.alt&&<figcaption className="de-cap" dir="auto">{block.alt}</figcaption>}</figure>:<p className="de-t de-img-out">{block.alt||block.url}</p>}</div>; }
    else if(block.t==='table') line=<div {...attrs}><div className="de-tw"><table className="de-tbl"><thead><tr>{block.rows[0]?.map((cell,n)=><th key={n} dir="auto" style={block.align[n]?{textAlign:block.align[n] as 'left'|'right'|'center'}:undefined}><Phrasing nodes={cell} slug={slug}/></th>)}</tr></thead>
     <tbody>{block.rows.slice(1).map((row,r)=><tr key={r}>{row.map((cell,n)=><td key={n} dir="auto" style={block.align[n]?{textAlign:block.align[n] as 'left'|'right'|'center'}:undefined}><Phrasing nodes={cell} slug={slug}/></td>)}</tr>)}</tbody></table></div></div>;
    else if(block.t==='code') line=<div {...attrs} dir="ltr"><pre className="de-t"><code>{block.value}</code></pre></div>;
    else if(block.t==='text') line=<div {...attrs} data-t="p" dir="auto"><p className="de-t">{block.value}</p></div>;
    else {
     let mark:ReactNode=null; const label=`${id}-t${index}`;
     if(block.t==='todo') { todo+=1; const item=items.get(block.line); const done=ticked[block.line]??block.done;
      mark=canTick&&item?<button type="button" className="de-box" role="checkbox" aria-checked={done} aria-labelledby={label} data-todo={todo} onClick={()=>press(block.line,!done)}><ShellIcon name="check"/></button>
       :<span className="de-box" role="checkbox" aria-checked={done} aria-disabled="true" aria-labelledby={label}><ShellIcon name="check"/></span>;
      line=<div {...attrs} data-c={done?'1':'0'} dir="auto"><span className="de-g">{mark}</span><div className="de-t" id={label}><Phrasing nodes={block.inline} slug={slug}/></div></div>; }
     else {
     if(block.t==='ul') mark=<span className="de-dot" aria-hidden="true"/>;
     if(block.t==='ol') mark=<span className="de-num num">{block.n}.</span>;
     const heading=block.t==='h1'?{role:'heading','aria-level':3}:block.t==='h2'?{role:'heading','aria-level':4}:{};
     line=<div {...attrs} dir="auto">{mark&&<span className="de-g">{mark}</span>}<div className="de-t" {...heading}><Phrasing nodes={block.inline} slug={slug}/></div></div>;
     }
    }
    return <Fragment key={block.key}>{count}{line}</Fragment>;
   })}
  </div>
  {fold!=='none'&&<button type="button" className="link-btn de-more" aria-controls={`${id}-de`} aria-expanded={fold==='open'} onClick={()=>setFold(fold==='open'?'folded':'open')}><ShellIcon name="chevronDown" className={fold==='open'?'de-more__up':undefined}/><span>{t(fold==='open'?'deShowLess':'deShowMore')}</span></button>}
  {said&&<p className="cw-said" role="alert">{said}</p>}
 </>;
}
