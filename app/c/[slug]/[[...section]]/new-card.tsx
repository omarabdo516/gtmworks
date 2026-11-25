'use client';
import { Suspense, lazy, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { CwMenu, type MenuItem } from '@/app/card-window';
import { CardDialog } from '@/app/card-dialog';
import type { NewCardAction } from './work';

const DescriptionEditor=lazy(()=>import('@/app/description-editor'));

// One New card form (#683; design-reference-card: ncOpen), for the toolbar's button (the Card lands in Planned) and the
// Ideas column's "+" (at the top of Ideas): a title, a description written as in a Card, an assignee or no one, and
// files. The Project the board is filtered by is the Card's. Loaded only when a new Card is started.
export default function NewCard({slug,company,me,status,project,agents,people,newCard,onClose,onMade}:{slug:string,company:string,me:string,status:'planned'|'ideas',project:string,
 agents:{id:string,name:string}[],people:{id:string,name:string}[],newCard:NewCardAction,onClose:()=>void,onMade:(id:number)=>void}) {
 const {t}=useI18n();
 // One key per opened form: a double press or a retried request is one Card.
 const [key]=useState(()=>crypto.randomUUID());
 const [title,setTitle]=useState(''); const [missing,setMissing]=useState(false); const [error,setError]=useState(''); const [pending,setPending]=useState(false);
 const [assignee,setAssignee]=useState(''); const [chosen,setChosen]=useState<string[]>([]);
 const description=useRef(''); const files=useRef<HTMLInputElement>(null); const titleField=useRef<HTMLInputElement>(null);
 const nameOf=(value:string)=>value.startsWith('a:')?agents.find(a=>a.id===value.slice(2))?.name??'':value.startsWith('p:')?people.find(p=>p.id===value.slice(2))?.name??'':'';
 const faceOf=(value:string)=>value.startsWith('a:')?<AgentFace agent={value.slice(2)} size={20}/>:value?<span className="avatar avatar--agent" aria-hidden="true">{Array.from(nameOf(value))[0]||'؟'}</span>:<span className="cw-noone" aria-hidden="true"/>;
 const items:MenuItem[]=[
  ...(agents.length?[{key:'g-a',group:t('ncAgents')},...agents.map(a=>({key:`a:${a.id}`,label:<bdi>{a.name}</bdi>,lead:<AgentFace agent={a.id} size={20}/>,checked:assignee===`a:${a.id}`,run:()=>setAssignee(`a:${a.id}`)}))]:[]),
  {key:'g-p',group:t('ncPeople')},
  {key:`p:${me}`,label:t('assignToMe'),checked:assignee===`p:${me}`,run:()=>setAssignee(`p:${me}`)},
  ...people.filter(p=>p.id!==me).map(p=>({key:`p:${p.id}`,label:<bdi>{p.name}</bdi>,checked:assignee===`p:${p.id}`,run:()=>setAssignee(`p:${p.id}`)})),
  {key:'none',label:t('ncNoOneYet'),checked:!assignee,run:()=>setAssignee('')},
 ];
 const submit=async()=>{
  if(!title.trim()) { setMissing(true); titleField.current?.focus(); return; }
  const form=new FormData(); for(const [name,value] of Object.entries({slug,company,key,title,status,assignee,project,description:description.current})) form.set(name,value);
  for(const file of files.current?.files??[]) form.append('files',file);
  setPending(true); setError('');
  let answer:Awaited<ReturnType<NewCardAction>>; try { answer=await newCard(form); } catch { answer={error:t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
  setPending(false);
  if('error' in answer) { setError(answer.error); return; }
  onMade(answer.id);
 };
 return <CardDialog title={t('newCard')} onClose={onClose}>
  <form className="nc" onSubmit={event=>{ event.preventDefault(); void submit(); }}>
   <label className="sr-only" htmlFor="nc-title">{t('title')}</label>
   <input ref={titleField} id="nc-title" className="set-input nc-title" dir="auto" autoFocus placeholder={t('title')} value={title} maxLength={500} aria-describedby="nc-title-err" aria-invalid={missing||undefined}
    onChange={event=>{ setTitle(event.target.value); if(event.target.value.trim()) setMissing(false); }}/>
   <span className="set-err" id="nc-title-err" hidden={!missing}>{t('ncTitleMissing')}</span>
   <div className="gw nc-desc"><Suspense fallback={<div className="navigation-progress" role="progressbar" aria-label={t('deLoading')}/>}>
    <DescriptionEditor body="" version={0} slug={slug} company={company} card={0} people={[...agents.map(a=>({...a,kind:'agent' as const})),...people.map(p=>({...p,kind:'person' as const}))]} draft label={t('cwDescription')}
     save={async text=>{ description.current=text; return {version:0,body:text,merged:false,conflicted:false}; }} upload={async()=>({error:t('deNotAPicture')})} onDone={()=>{}}/>
   </Suspense></div>
   <div className="nc-row">
    <CwMenu label={t('cwPropertyValue',t('assignee'),nameOf(assignee)||t('ncNoOneYet'))} className="btn btn--secondary btn--sm nc-asg" radio items={items}
     button={<>{faceOf(assignee)}<bdi className="od-truncate">{nameOf(assignee)||t('ncNoOneYet')}</bdi><ShellIcon name="chevronDown"/></>}/>
    <span className="od-fill"/>
    <label className="ib" title={t('attachFiles')}><ShellIcon name="clip"/><input ref={files} type="file" multiple className="sr-only" aria-label={t('attachFiles')} onChange={event=>setChosen([...(event.target.files||[])].map(file=>file.name))}/></label>
   </div>
   {chosen.length>0&&<div className="composer__files">{chosen.map((name,n)=><span key={n} className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{name}</bdi></span>)}</div>}
   {error&&<p className="cw-said" role="alert">{error}</p>}
   <div className="nc-foot"><button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>{t('cancel')}</button>
    <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>{t('ncAdd')}</button></div>
  </form>
 </CardDialog>;
}
