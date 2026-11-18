'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { FileName } from '@/components/file-name';
import { useI18n } from '@/lib/i18n-client';
import { fileSize } from '@/lib/agent-details.mjs';
import { csvRows } from '@/lib/file-preview.mjs';
import { leave } from '@/lib/motion';
import { FeedWhen } from '@/app/c/[slug]/log/log-client';
import { toast } from '@/app/toast';
import './shell.css';

// One file of an Agent's Library, read-only (#195; design-reference: openPreview, previewBodyHTML, the #preview close
// handler, closeDlg, toast): its name over the Agent's name, when it was saved and its size, and a body that is a raster
// picture, text or Markdown as plain text in its own direction, a CSV's first rows as a table, or its icon and a
// Download. The Engine reads the text and says whether more follows; the picture is drawn through the download route,
// which serves inline only the raster types. A vector image or a page is never drawn. The foot says it is read-only and
// carries Download, which is where the keyboard starts. Closing — the button, Escape or a press on the backdrop — runs
// the reference's 190 ms leave and then hands the keyboard back to the file's row.
export type PreviewFile={name:string,folder:string,size:number|null,time:string|null};
type Body={kind:'image'|'text'|'table'|'none',type:string,byteSize:number,truncated:boolean,text:string|null};
type Read={state:'loading'}|{state:'failed'}|{state:'found',body:Body};

// modalOut in shell.css, as the reference's closeDlg waits.
const leaveMs=190;

export function AgentFilePreview({company,slug,agent,agentName,file,onClosed}:{company:string,slug:string;agent:string;agentName:string;file:PreviewFile;onClosed:()=>void}) {
 const {t}=useI18n();
 const [read,setRead]=useState<Read>({state:'loading'});
 const box=useRef<HTMLDialogElement>(null); const downloadButton=useRef<HTMLAnchorElement>(null);
 const [leaving,setLeaving]=useState(false); const stopLeaving=useRef(()=>{});

 useEffect(()=>{
  let live=true;
  const query=new URLSearchParams({company,agent,name:file.name,...(file.folder?{folder:file.folder}:{})});
  void fetch(`/api/agent-files/preview?${query}`,{cache:'no-store'})
   .then(response=>response.ok?response.json():null)
   .then(body=>{ if(live) setRead(typeof body?.kind==='string'?{state:'found',body:body as Body}:{state:'failed'}); })
   .catch(()=>{ if(live) setRead({state:'failed'}); });
  return ()=>{ live=false; };
 },[company,agent,file.name,file.folder]);

 // The dialog is modal, so the page behind it is inert; the keyboard starts on Download, as the reference puts it.
 useLayoutEffect(()=>{
  if(box.current&&!box.current.open) box.current.showModal();
  downloadButton.current?.focus();
  return ()=>stopLeaving.current();
 },[]);
 const download=`/c/${encodeURIComponent(slug)}/agent-files/${encodeURIComponent(agent)}?${new URLSearchParams({...(file.folder?{folder:file.folder}:{}),name:file.name})}`;
 const close=()=>{
  const dialog=box.current; if(!dialog?.open||leaving) return;
  stopLeaving.current=leave(leaveMs,()=>setLeaving(true),()=>dialog.close());
 };
 // However it closed, the Library takes the keyboard back to the file's row.
 const closed=()=>{ stopLeaving.current(); setLeaving(false); onClosed(); };

 const body=read.state==='found'?read.body:null;
 let content=null;
 if(read.state==='failed') content=<p className="pv-note">{t('agentFilePreviewUnreadable')}</p>;
 else if(body?.kind==='image') content=<figure className="pv-fig"><img className="pv-img" src={download} alt={file.name}/></figure>;
 else if(body?.kind==='table'&&body.text!==null) {
  const rows=csvRows(body.text);
  content=<div className="table-wrap"><table className="table">
   {rows.length>1?<thead><tr>{rows[0].map((cell,at)=><th key={at}>{cell}</th>)}</tr></thead>:null}
   <tbody>{(rows.length>1?rows.slice(1):rows).map((row,at)=><tr key={at}>{row.map((cell,column)=><td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
 } else if(body?.kind==='text'&&body.text!==null) content=<pre className="pv-text" dir="auto">{body.text}</pre>;
 else if(body?.kind==='none') content=<div className="pv-none"><ShellIcon name="file"/><span><FileName name={file.name}/></span></div>;

 return <dialog ref={box} className={`pv${leaving?' is-closing':''}`} aria-labelledby="preview-title"
  onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed}
  onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="pv__inner">
   <header className="modal__head">
    <span className="lib-thumb lib-thumb--lg">{body?.kind==='image'?<img className="lib-thumb__img" src={download} alt=""/>:<ShellIcon name="file"/>}</span>
    <div className="modal__titles">
     <h2 className="modal__title pv-title" id="preview-title"><FileName name={file.name}/></h2>
     <p className="modal__sub"><bdi>{agentName}</bdi>{file.time?<>{' · '}<FeedWhen value={file.time}/></>:null}{file.size===null?null:<>{' · '}<bdi dir="ltr">{fileSize(file.size)}</bdi></>}</p>
    </div>
    <button type="button" className="circle-btn" aria-label={t('sheetClose')} onClick={close}><ShellIcon name="x"/></button>
   </header>
   <div className="pv__body">{content}{body?.truncated?<p className="pv-more">{t('agentFilePreviewMore',fileSize(body.byteSize))}</p>:null}</div>
   <footer className="modal__foot">
    <span className="modal__foot-t">{t('agentFilePreviewReadOnly',agentName)}</span>
    <a ref={downloadButton} className="btn btn--primary" href={download} download onClick={()=>toast(t('agentLibraryDownloading',file.name),{icon:'download'})}><ShellIcon name="download"/><span>{t('agentFilePreviewDownload')}</span></a>
   </footer>
  </div>
 </dialog>;
}
