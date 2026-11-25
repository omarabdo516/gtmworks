'use client';
import { Suspense, lazy, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { CardDescription, type TickTodo } from '@/app/card-description';
import type { DescriptionSaved, PictureUploaded } from '@/app/description-editor';

// The editor's JavaScript is loaded only when a description is edited (#680): reading and ticking need none of it.
const DescriptionEditor=lazy(()=>import('./description-editor'));

// A Card's description where it is read and written (#679, #680; design-reference-card: deReadHTML, cw-desc-edit): read
// drawn and ticked while reading; a writer opens it in place with Edit (or by pressing an empty one), and it saves by itself.
export function DescriptionPlace({body,version,slug,company,card,canWrite,people,tick,save,upload}:{body:string,version:number,slug:string,company:string,card:number,canWrite:boolean,
 people:{id:string,name:string,kind:'person'|'agent'}[],tick?:TickTodo,save:(body:string,base:number)=>Promise<DescriptionSaved>,upload:(form:FormData)=>Promise<PictureUploaded>}) {
 const {t}=useI18n(); const [editing,setEditing]=useState(false);
 if(editing&&canWrite) return <Suspense fallback={<div className="navigation-progress" role="progressbar" aria-label={t('deLoading')}/>}>
  <DescriptionEditor body={body} version={version} slug={slug} company={company} card={card} people={people} save={save} upload={upload} onDone={()=>setEditing(false)}/>
 </Suspense>;
 if(!body.trim()) return canWrite?<button type="button" className="cw-empty cw-empty--btn" onClick={()=>setEditing(true)}>{t('deAdd')}</button>:null;
 return <div className="de-read">
  <CardDescription body={body} slug={slug} canTick={canWrite} tick={tick}/>
  {canWrite&&<button type="button" className="link-btn de-edit" onClick={()=>setEditing(true)}><ShellIcon name="pencil"/><span>{t('deEdit')}</span></button>}
 </div>;
}
