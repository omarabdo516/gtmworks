'use client';
// The Library of an Agent (#194; design-reference: libraryHTML, libThumb, libDownload, fname, filesWord, the .lib-*
// rules): the folders and files saved in the Agent's own Engine profile, read from GET /api/agent-files after the panel
// is drawn so no page waits on the Engine. The Owner and Managers have it; a Contributor or a Viewer is drawn no Library
// at all and is refused by that route. A folder opens in place with its own count and the newest file's day, a file
// downloads from the address beside it, and the preview dialog is #195. Nothing here names the Engine, and no path on
// its disk reaches this page: each row is a name, a size, a time and a folder or a file.
import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { fileSize } from '@/lib/agent-details.mjs';
import { FeedWhen } from '@/app/c/[slug]/log/log-client';
import { toast } from '@/app/toast';
import type { LibraryRow } from '@/lib/agent-files.mjs';

// The folder last read, and the folder it was read for: a folder the reader has just opened is drawn as loading until
// its own answer lands, without an effect setting the state it is already in.
type Read={key:string,state:'loading'}|{key:string,state:'found',entries:LibraryRow[]}|{key:string,state:'failed'};

// A file's name as the reference writes it (fname): an Arabic name keeps its extension at its end, a Latin one runs left
// to right as a whole.
function FileName({name}:{name:string}) {
 const at=name.lastIndexOf('.');
 const base=at>0?name.slice(0,at):name; const extension=at>0?name.slice(at):'';
 if(/^[A-Za-z0-9]/.test(base)) return <bdi dir="ltr">{name}</bdi>;
 return <><bdi dir="rtl">{base}</bdi>{extension?<bdi dir="ltr">{extension}</bdi>:null}</>;
}

export function AgentLibrary({company,slug,agent,name}:{company:string,slug:string;agent:string;name:string}) {
 const {t}=useI18n();
 const [path,setPath]=useState<string[]>([]);
 const [read,setRead]=useState<Read>({key:'',state:'loading'});
 const rootHeading=useRef<HTMLHeadingElement>(null); const folderHeading=useRef<HTMLHeadingElement>(null);
 const rows=useRef(new Map<string,HTMLButtonElement>());
 // A move the reader made takes the focus where the reference puts it: the opened folder's own name, and on the way
 // back the folder's row itself. Drawing the panel never takes the focus.
 const moving=useRef<'in'|'out'|null>(null); const backTo=useRef<string|null>(null);

 const key=path.join('/');
 useEffect(()=>{
  let live=true;
  const folder=key?`&folder=${encodeURIComponent(key)}`:'';
  void fetch(`/api/agent-files?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}${folder}`,{cache:'no-store'})
   .then(response=>response.ok?response.json():null)
   .then(body=>Array.isArray(body?.entries)?body.entries as LibraryRow[]:null)
   .catch(()=>null)
   .then(entries=>{ if(live) setRead(entries?{key,state:'found',entries}:{key,state:'failed'}); });
  return ()=>{ live=false; };
 },[company,agent,key]);
 const shown:Read=read.key===key?read:{key,state:'loading'};

 // Once the folder is drawn, the move takes the focus; the first draw leaves it where it was.
 useEffect(()=>{
  if(read.key!==key||read.state!=='found'||!moving.current) return;
  if(moving.current==='in') folderHeading.current?.focus();
  else { const row=backTo.current?rows.current.get(backTo.current):null; if(row) row.focus(); else rootHeading.current?.focus(); }
  moving.current=null;
 },[read,key]);

 const open=(folder:string)=>{ moving.current='in'; setPath([...path,folder]); };
 const up=()=>{ backTo.current=path[path.length-1]??null; moving.current='out'; setPath(path.slice(0,-1)); };

 const entries=shown.state==='found'?shown.entries:null;
 // The root counts every file the Agent has here, as the reference's Library does; a folder counts the rows it shows.
 const count=path.length?entries?.length??0:(entries??[]).reduce((total,entry)=>total+(entry.isFolder?entry.files??0:1),0);
 const filesWord=(n:number)=>n===1?t('agentLibraryFilesOne'):n===2?t('agentLibraryFilesTwo'):n<=10?t('agentLibraryFilesFew',n):t('agentLibraryFilesMany',n);
 const download=(entry:LibraryRow)=>`/c/${encodeURIComponent(slug)}/agent-files/${encodeURIComponent(agent)}?${new URLSearchParams({...(path.length?{folder:path.join('/')}:{}),name:entry.name})}`;

 const list=entries&&entries.length?<ul className="panel-card">{entries.map(entry=>entry.isFolder?
  <li key={entry.name} className="panel-row lib-file"><button type="button" className="lib-file__main lib-folder" ref={node=>{ if(node) rows.current.set(entry.name,node); else rows.current.delete(entry.name); }} onClick={()=>open(entry.name)}>
   <span className="panel-row__icon"><ShellIcon name="folder"/></span>
   <span className="panel-row__text"><span className="panel-row__t lib-1l" title={entry.name}><FileName name={entry.name}/></span>
    <span className="panel-row__d lib-1l">{entry.files===null?null:entry.files===0?t('agentLibraryFolderEmptyRow')
     :<>{filesWord(entry.files)}{entry.latest?<> {t('agentLibraryLatest')} <FeedWhen value={entry.latest}/></>:null}</>}</span></span>
   <ShellIcon name="chevron" className="lib-chev"/>
  </button></li>
  :<li key={entry.name} className="panel-row lib-file">
   <span className="lib-file__main">
    <span className="lib-thumb"><ShellIcon name="file"/></span>
    <span className="panel-row__text"><span className="panel-row__t lib-1l" title={entry.name}><FileName name={entry.name}/></span>
     <span className="panel-row__d lib-1l">{entry.size===null?null:<bdi dir="ltr">{fileSize(entry.size)}</bdi>}{entry.time?<>{entry.size===null?null:' · '}<FeedWhen value={entry.time}/></>:null}</span></span>
   </span>
   <a className="circle-btn lib-dl" href={download(entry)} download onClick={()=>toast(t('agentLibraryDownloading',entry.name),{icon:'download'})} aria-label={t('agentLibraryDownload',entry.name)} title={t('agentLibraryDownload',entry.name)}><ShellIcon name="download"/></a>
  </li>)}</ul>:null;

 const blank=shown.state==='failed'
  ?<div className="panel-card"><div className="lib-empty"><ShellIcon name="folder"/><p>{t('agentLibraryUnreadable')}</p></div></div>
  :entries&&!entries.length?<div className="panel-card"><div className="lib-empty"><ShellIcon name="folder"/><p>{path.length?t('agentLibraryFolderEmpty'):t('agentLibraryEmpty',name)}</p></div></div>
  :null;

 if(!path.length) return <section className="dp-sec dp-library" aria-labelledby="dp-lib-h">
  <h3 className="dp-label" id="dp-lib-h" tabIndex={-1} ref={rootHeading}><span>{t('agentLibraryOf',name)} <span className="muted num">{count}</span></span></h3>
  {list??blank}
  <p className="lib-hint">{t('agentLibraryHint',name)}</p>
 </section>;

 const current=path[path.length-1];
 return <section className="dp-sec dp-library" aria-labelledby="dp-lib-cur">
  <nav className="lib-crumbs" aria-label={t('agentLibraryPlace')}>
   <button type="button" className="link-btn" onClick={up}>{t('agentLibraryOf',name)}</button>
   <ShellIcon name="chevron"/>
   <h3 className="lib-crumbs__cur" id="dp-lib-cur" tabIndex={-1} ref={folderHeading} aria-current="location">{current} <span className="muted num">{count}</span></h3>
  </nav>
  {list??blank}
 </section>;
}
