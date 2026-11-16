'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/paperclip/ui/dialog';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { newId, postMessage } from '@/app/conversation-composer';
import type { ReadyRole } from '@/lib/ready-roles';
import enText from '@/lib/messages/ready-made.en.json';
import arText from '@/lib/messages/ready-made.ar.json';

type Category=ReadyRole['category'];
// The reference's order of categories (TPL_CATS); one with no role is not offered.
const order:Category[]=['ads','content','numbers','code'];

// The ready-made gallery (#14; design-reference: galleryHTML, tplCardHTML, tplGridHTML), at ?new=ready over Lead's
// chat, for the Owner only (the server decides, page.tsx). The cards come from the server (lib/ready-roles.ts). Adding
// a role sends Lead the message that asks for it, as if typed, so the Agent made is the one asking Lead makes. Leaving
// returns to ?new=agent, where the composer takes the focus. It loads in its own chunk with its strings
// (ready-made.en.json and ready-made.ar.json).
export default function ReadyMade({slug,company,agent,companyName,alone,lead,roles}:{slug:string,company:string,agent:string,companyName:string,alone:boolean,lead:string,roles:ReadyRole[]}) {
 const {t:say,language}=useI18n(); const text:Record<string,string>=language==='ar'?arText:enText;
 const t=(key:string,value='')=>text[key].replace('{0}',()=>value);
 const router=useRouter(); const search=useRef<HTMLInputElement>(null);
 const [open,setOpen]=useState(true); const [query,setQuery]=useState(''); const [category,setCategory]=useState<Category|'all'>('all');
 const [sending,setSending]=useState(false); const [failure,setFailure]=useState('');
 // One Conversation and send key per role picked, kept for a retry or a second click, so it is asked once.
 const picks=useRef<Partial<Record<string,{conversation:string,sendKey:string}>>>({});
 // A send still on its way when the gallery closes must not move the page that took its place.
 const active=useRef(true);
 useEffect(()=>{ active.current=true; return ()=>{ active.current=false; }; },[]);
 const leave=()=>{ active.current=false; setOpen(false); router.replace(`/c/${slug}/chat?new=agent`); };
 async function add(role:ReadyRole) {
  if(sending) return;
  setSending(true); setFailure('');
  const pick=picks.current[role.id]??={conversation:newId(),sendKey:newId()};
  const failed=await postMessage({company,conversation:pick.conversation,agent,message:role.ask,sendKey:pick.sendKey});
  if(!active.current) return;
  if(!failed) return router.replace(`/c/${slug}/conversations/${pick.conversation}`);
  setFailure(failed); setSending(false);
 }
 const needle=query.trim().toLowerCase();
 const shown=roles.filter(role=>(category==='all'||role.category===category)&&role.search.includes(needle));
 return <Dialog open={open} onOpenChange={next=>{if(!next) leave();}}>
  <DialogContent showCloseButton={false} className="gw modal" onOpenAutoFocus={event=>{event.preventDefault();search.current?.focus();}} onCloseAutoFocus={event=>event.preventDefault()}>
   <div className="modal__inner">
    <header className="modal__head">
     <div className="modal__titles"><DialogTitle className="modal__title">{t('title')} <bdi>{companyName}</bdi></DialogTitle>
      <DialogDescription className="modal__sub">{alone?t('subAlone',lead):t('subTeam',companyName)}</DialogDescription></div>
     <button type="button" className="circle-btn" aria-label={t('close')} onClick={leave}><ShellIcon name="x"/></button>
    </header>
    <div className="modal__tools">
     <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{t('search')}</span><input ref={search} id="tpl-q" type="search" autoComplete="off" placeholder={t('searchHint')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
     <div className="tpl-cats" role="group" aria-label={t('categories')}>{(['all',...order.filter(kind=>roles.some(role=>role.category===kind))] as const).map(kind=>
      <button key={kind} type="button" className="chip" aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{t(`category.${kind}`)}<span className="chip__n">{roles.filter(role=>kind==='all'||role.category===kind).length}</span></button>)}</div>
     {failure&&<p role="alert" className="composer-error">{say(failure)}</p>}
    </div>
    <div className="tpl-grid" aria-live="polite">{shown.length?shown.map(role=><article key={role.id} className="tpl" aria-labelledby={`tpl-t-${role.id}`}>
     <div className="tpl__top"><span className="tpl__face" aria-hidden="true"><CompanyAgentFace agent={{connection_id:role.name,name:role.role}} size={44}/></span>
      <div className="tpl__titles"><h3 className="tpl__role" id={`tpl-t-${role.id}`}>{role.role}</h3><span className="tpl__cat">{t(`category.${role.category}`)}{alone?'':` · ${t('team')}`}</span></div></div>
     <p className="tpl__line">{role.line}</p>
     {role.handoff&&<p className="tpl__hand"><ShellIcon name="hand"/><span>{role.handoff}</span></p>}
     <div className="tpl__foot">
      {/* The tiles draw the apps (design-reference: tplCardHTML); a screen reader reads their names. */}
      <span className="tpl__tools">{role.apps.length?<>{role.apps.map(app=><AppTile key={app.key} app={app}/>)}<span className="tpl__apps sr-only">{role.apps.map((app,index)=><Fragment key={app.key}>{index>0&&' · '}<bdi>{app.name}</bdi></Fragment>)}</span></>:<span className="tpl__none">{t('noApps')}</span>}</span>
      <button type="button" className="btn btn--secondary btn--sm" aria-label={t('addLabel',role.role)} disabled={sending} onClick={()=>void add(role)}>{t('add')}</button>
     </div>
    </article>):<div className="tpl-empty"><b>{needle?t('noMatch',query.trim()):t('noneHere')}</b><span>{t('emptyHint')}</span>
     <div className="tpl-empty__acts">{needle&&<button type="button" className="btn btn--secondary btn--sm" onClick={()=>{setQuery('');search.current?.focus();}}>{t('clear')}</button>}
      <button type="button" className="btn btn--secondary btn--sm" onClick={leave}>{t('scratch')}</button></div></div>}</div>
    <footer className="modal__foot"><span className="modal__foot-t">{t('notFound')}</span><button type="button" className="btn btn--secondary" onClick={leave}>{t('scratch')}</button></footer>
   </div>
  </DialogContent>
 </Dialog>;
}
