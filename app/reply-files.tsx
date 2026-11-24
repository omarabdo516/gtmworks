'use client';

import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { named } from '@/lib/bidi';

// The files an Agent handed over in its reply (#708, ADR 0028), under its bubble on the Agent's side: each the same chip
// a person's message shows (design-reference: filesHTML), opened and downloaded by its own route, and an image drawn as
// a thumbnail of itself. A file the reply named but could not hand over is one quiet line with its name, never a path.
export function ReplyFiles({files=[],missed=[],href}:{files?:{id:number,name:string,image?:true}[],missed?:string[],href:(id:number)=>string}) {
 const {t}=useI18n();
 if(!files.length&&!missed.length) return null;
 return <>
  {!!files.length&&<div className="msg-files msg-files--reply">{files.map(file=>file.image
   ?<a key={file.id} className="file-thumb" href={href(file.id)} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)}>
     {/* eslint-disable-next-line @next/next/no-img-element -- the file's own private route, never an optimised image */}
     <img src={href(file.id)} alt="" loading="lazy"/><span className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></span></a>
   :<a key={file.id} className="file-chip" href={href(file.id)} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}
  {missed.map((name,index)=><p key={`${index}:${name}`} className="note" role="note" data-outcome="file-missed">{named(t,'replyFileMissed',name)}</p>)}
 </>;
}
