'use client';
import { useRef, useState, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import type { CardFile } from '@/lib/company-card.mjs';
import './card-files.css';

// A Card's files (spec #831, #843; design-reference-card: cwSideHTML's files row, cwFiles, fileChip, cwResultHTML's
// .cw-files). The details list every file of the Card, a person's and those its Agent named, each a chip that downloads
// it through gtmworks (/c/<slug>/files/board/<card>/<key>), under who added it; an image is a thumbnail of itself above
// its chip. An Agent's file whose work sandbox is stopped is listed and says it cannot be read now. A Member who may
// write adds files with the row's button; a file past the Engine's cap is refused here, by name and with the cap named,
// before any byte is sent, and the route refuses it again.

// The Engine's own cap for a Card's file (lib/engine/board.mjs cardFileLimit, hermes_cli/kanban_db.py).
const limitMb=25;
const limit=limitMb*1024*1024;
type Say=(key:string,...values:unknown[])=>string;

function FileChip({file,href,c,who}:{file:CardFile,href:string,c:Say,who?:string}) {
 if(file.state!=='ready') return <span className="file-chip cw-file is-off" aria-disabled="true" title={who}><ShellIcon name="file"/><bdi dir="auto">{file.name}</bdi></span>;
 return <a className="file-chip cw-file" href={href} download={file.image?undefined:file.name} target={file.image?'_blank':undefined} rel={file.image?'noopener':undefined}
  aria-label={c('cwFileOpen',file.name)} title={who}><ShellIcon name="file"/><bdi dir="auto">{file.name}</bdi></a>;
}

// One file as the details list it: an image's thumbnail above its chip, and a line when it cannot be read now.
function FileRow({file,href,c,who}:{file:CardFile,href:string,c:Say,who:string}) {
 return <li className="cw-fl" data-file={file.key}>
  {file.image&&file.state==='ready'&&<a className="file-thumb cw-thumb" href={href} target="_blank" rel="noopener" tabIndex={-1} aria-hidden="true"><img src={href} alt="" loading="lazy"/></a>}
  <FileChip file={file} href={href} c={c} who={who}/>
  {file.state==='notNow'&&<span className="cw-fl__note">{c('cwFileNotNow')}</span>}
  {file.state==='unservable'&&<span className="cw-fl__note">{c('cwFileUnservable')}</span>}
 </li>;
}

/** The files under an Agent's summary or comment: their chips, an image's thumbnail above its own. */
export function CardFileChips({files,href,c}:{files:CardFile[],href:(file:CardFile)=>string,c:Say}) {
 if(!files.length) return null;
 return <ul className="cw-files">{files.map(file=><FileRow key={file.key} file={file} href={href(file)} c={c} who=""/>)}</ul>;
}

/** The details' files row, with the button that adds files for a Member who may write. */
export function CardFilesRow({company,card,files,href,writer,c,whoOf,onAdded}:{company:string,card:string,files:CardFile[],href:(file:CardFile)=>string,writer:boolean,c:Say,
 whoOf:(file:CardFile)=>string,onAdded:()=>void}) {
 const input=useRef<HTMLInputElement>(null);
 const [said,setSaid]=useState<{text:string,bad:boolean}|null>(null);
 const [adding,setAdding]=useState(false);
 async function add(chosen:File[]) {
  if(!chosen.length) return;
  // A file past the cap is never sent: it is named with the cap, and the rest go on.
  const over=chosen.filter(file=>file.size>limit); const going=chosen.filter(file=>file.size<=limit&&file.size>0);
  const lines:string[]=over.map(file=>c('cwFileTooLarge',file.name,limitMb));
  setAdding(true); setSaid(going.length?{text:going.length===1?c('cwFileAdding',going[0].name):c('cwFilesAdding',going.length),bad:false}:null);
  let added=0;
  for(const file of going) {
   const form=new FormData(); form.append('file',file,file.name);
   let answer:Response|null=null;
   try { answer=await fetch(`/api/board/card/files?company=${encodeURIComponent(company)}&card=${encodeURIComponent(card)}`,{method:'POST',body:form}); } catch { answer=null; }
   const body=await answer?.json().catch(()=>null) as {error?:string}|null;
   if(answer?.ok) { added++; continue; }
   lines.push(body?.error==='cardFileTooLarge'?c('cwFileTooLarge',file.name,limitMb):body?.error==='cardNotAllowed'?c('cwFileNotAllowed'):c('cwFileFailed',file.name));
  }
  setAdding(false);
  if(added) onAdded();
  setSaid(lines.length?{text:lines.join(' '),bad:true}:added?{text:added===1?c('cwFileAdded'):c('cwFilesAdded',added),bad:false}:null);
 }
 const picker=<input ref={input} type="file" multiple hidden onChange={event=>{ const chosen=[...event.currentTarget.files??[]]; event.currentTarget.value=''; void add(chosen); }}/>;
 const addLabel=c('cwAddFiles');
 let row:ReactNode=null;
 if(files.length) row=<div className="cwp cwp--chips cw-files-row"><span className="cwp__ic" title={c('cwFiles')} aria-hidden="true"><ShellIcon name="clip"/></span><span className="sr-only">{c('cwFiles')}:</span>
  <ul className="cw-fls">{files.map(file=><FileRow key={file.key} file={file} href={href(file)} c={c} who={whoOf(file)}/>)}</ul>
  {writer&&<button type="button" className="ib ib--sm" aria-label={addLabel} title={addLabel} disabled={adding} onClick={()=>input.current?.click()}><ShellIcon name="plus"/></button>}</div>;
 else if(writer) row=<div className="cwp cw-files-row"><button type="button" className="cwp__b is-empty" aria-label={addLabel} title={c('cwFiles')} disabled={adding} onClick={()=>input.current?.click()}>
  <span className="cwp__ic"><ShellIcon name="clip"/></span><span className="cwp__add">{c('cwAdd')}</span></button></div>;
 return <>{row}{writer&&picker}{said&&<p className={`cw-said${said.bad?' is-bad':''}`} role={said.bad?'alert':'status'}>{said.text}</p>}</>;
}
