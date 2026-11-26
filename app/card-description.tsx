'use client';
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { lineDirection, numberOf, parseDescription, parseInline, todoRuns, type Block, type Inline } from '@/lib/card-description.mjs';

// A Card's description read drawn (spec #831, #835; design-reference-card: deHTML, deReadHTML, deFold): one block per
// line, each in its own direction with its marker on its own start; the count of each run of to-do items sits above it,
// and each item is ticked or not. Reading ticks nothing here: a to-do is ticked by editing the Card (#837). Nothing is
// drawn as HTML, a link leads only to a web page or an email address, and a picture is drawn as its words, never
// loaded. A long description folds after about twelve lines.

function Phrasing({parts}:{parts:Inline[]}):ReactNode {
 return parts.map((part,index)=>{
  if(part.t==='text') return <Fragment key={index}>{part.v}</Fragment>;
  if(part.t==='code') return <code key={index} className="de-c" dir="ltr">{part.v}</code>;
  if(part.t==='br') return <br key={index}/>;
  if(part.t==='b') return <b key={index}><Phrasing parts={part.in}/></b>;
  if(part.t==='s') return <s key={index}><Phrasing parts={part.in}/></s>;
  if(part.t==='i') return <i key={index}><Phrasing parts={part.in}/></i>;
  if(part.t!=='a') return null;
  return part.href?<a key={index} className="de-a" href={part.href} target="_blank" rel="noopener noreferrer nofollow"><Phrasing parts={part.in}/></a>:<Fragment key={index}><Phrasing parts={part.in}/></Fragment>;
 });
}

export function CardDescription({body,ui,c}:{body:string,ui:'rtl'|'ltr',c:(key:string)=>string}) {
 const id=useId();
 const blocks=parseDescription(body); const runs=todoRuns(blocks);
 const box=useRef<HTMLDivElement>(null); const [fold,setFold]=useState<'none'|'folded'|'open'>('none');
 useLayoutEffect(()=>{ const element=box.current; if(!element||fold==='open') return;
  const line=parseFloat(getComputedStyle(element).lineHeight)||25; const cap=Math.round(line*12);
  element.style.setProperty('--de-cap',`${cap}px`);
  setFold(element.scrollHeight>cap+line*2?'folded':'none'); },[body,fold]);
 if(!blocks.length) return null;
 return <>
  <div ref={box} id={`${id}-de`} className={`de de--read${fold==='folded'?' is-fold':''}`}>
   {blocks.map((block:Block,index:number)=>{
    const run=runs.get(index);
    const own='x' in block?lineDirection(block.x):block.t==='img'?lineDirection(block.alt):block.t==='table'?lineDirection(block.rows.map(row=>row.join(' ')).join(' ')):'';
    const dir=block.t==='code'?'ltr':own||(block.t==='hr'?ui:'auto');
    const count=run&&<div className={`de-prog${run.done===run.total?' is-all':''}`} dir={lineDirection('x' in block?block.x:'')||ui}>
     <span className="de-prog__t num" dir={ui}><bdi dir="ltr">{run.done}/{run.total}</bdi><span className="sr-only"> {c('deTodosDone')}</span></span>
     <span className="bar de-prog__bar" aria-hidden="true"><span className="bar__fill" style={{transform:`scaleX(${run.total?run.done/run.total:0})`}}/></span></div>;
    const attrs={className:'de-b','data-t':block.t,'data-l':block.l,dir};
    let line:ReactNode;
    if(block.t==='hr') line=<div {...attrs}><hr className="de-hr"/></div>;
    else if(block.t==='img') line=<div {...attrs}><p className="de-t de-img-out">{block.alt||block.src}</p></div>;
    else if(block.t==='table') line=<div {...attrs}><div className="de-tw"><table className="de-tbl"><thead><tr>{block.rows[0].map((cell,n)=><th key={n} dir="auto"><Phrasing parts={parseInline(cell)}/></th>)}</tr></thead>
     <tbody>{block.rows.slice(1).map((row,r)=><tr key={r}>{row.map((cell,n)=><td key={n} dir="auto"><Phrasing parts={parseInline(cell)}/></td>)}</tr>)}</tbody></table></div></div>;
    else if(block.t==='code') line=<div {...attrs}><pre className="de-t"><code>{block.x}</code></pre></div>;
    else {
     let mark:ReactNode=null; const label=`${id}-t${index}`;
     if(block.t==='todo') mark=<span className="de-box" role="checkbox" aria-checked={!!block.c} aria-disabled="true" aria-labelledby={label}><ShellIcon name="check"/></span>;
     else if(block.t==='ul') mark=<span className="de-dot" aria-hidden="true"/>;
     else if(block.t==='ol') mark=<span className="de-num num">{numberOf(blocks,index)}.</span>;
     const heading=block.t==='h1'?{role:'heading','aria-level':3}:block.t==='h2'?{role:'heading','aria-level':4}:{};
     line=<div {...attrs} {...block.t==='todo'?{'data-c':block.c?'1':'0'}:{}}>{mark&&<span className="de-g">{mark}</span>}<div className="de-t" id={label} {...heading}><Phrasing parts={parseInline(block.x)}/></div></div>;
    }
    return <Fragment key={index}>{count}{line}</Fragment>;
   })}
  </div>
  {fold!=='none'&&<button type="button" className="de-more" aria-controls={`${id}-de`} aria-expanded={fold==='open'} onClick={()=>setFold(fold==='open'?'folded':'open')}><ShellIcon name="chevronDown" className={fold==='open'?'de-more__up':undefined}/><span>{c(fold==='open'?'deShowLess':'deShowMore')}</span></button>}
 </>;
}
