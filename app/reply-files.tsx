'use client';

import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { named } from '@/lib/bidi';
import type { MessageFile } from '@/lib/conversations';

// The files an Agent handed over in its reply (#708, ADR 0028), under its bubble on the Agent's side: each the same chip
// a person's message shows (design-reference: filesHTML), opened and downloaded by its own route, and an image drawn as
// a thumbnail of itself. A file the reply named but could not hand over is one quiet line with its name, never a path.
// A file read from the work sandbox while it is stopped (#880, `notNow`) is listed, cannot be opened, and says why.
export function ReplyFiles({files=[],missed=[],href}:{files?:MessageFile[],missed?:string[],href:(file:MessageFile)=>string}) {
 const {t}=useI18n();
 if(!files.length&&!missed.length) return null;
 const off=files.filter(file=>file.state==='notNow');
 return <>
  {!!files.length&&<div className="msg-files msg-files--reply">{files.map(file=>file.state==='notNow'
   ?<span key={file.key??file.id} className="file-chip is-off" aria-disabled="true" data-file={file.key}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></span>
   :file.image
   ?<a key={file.key??file.id} className="file-thumb" href={href(file)} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)} data-file={file.key}>
     {/* eslint-disable-next-line @next/next/no-img-element -- the file's own private route, never an optimised image */}
     <img src={href(file)} alt="" loading="lazy"/><span className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></span></a>
   :<a key={file.key??file.id} className="file-chip" href={href(file)} download={file.key?file.name:undefined} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)} data-file={file.key}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>)}</div>}
  {off.map(file=><p key={`off:${file.key??file.id}`} className="note" role="note" data-outcome="file-not-now">{named(t,'replyFileNotNow',file.name)}</p>)}
  {missed.map((name,index)=><p key={`${index}:${name}`} className="note" role="note" data-outcome="file-missed">{named(t,'replyFileMissed',name)}</p>)}
 </>;
}
