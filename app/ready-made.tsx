'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { useLeave } from '@/lib/motion';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/paperclip/ui/dialog';
import { AgentFace } from '@/components/agent-face';
import { LooksProvider } from '@/lib/agent-looks-client';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { newId, postMessage } from '@/app/conversation-composer';
import type { ReadyRole } from '@/lib/ready-roles';
import enText from '@/lib/messages/ready-made.en.json';
import arText from '@/lib/messages/ready-made.ar.json';

type Category=ReadyRole['category'];
// The reference's order of categories (TPL_CATS); one with no role is not offered.
const order:Category[]=['ads','content','numbers','code'];

// The ready-made gallery (#14, #189; design-reference: galleryHTML, tplCardHTML, tplGridHTML), at ?new=ready over Lead's
// chat. The cards come from the server (lib/ready-roles.ts). The Owner adds a role: it sends Lead the message that asks
// for it, as if typed, so the Agent made is the one asking Lead makes. A Manager or a Contributor asks for it instead
// (#17): the same message asks Lead to prepare the request their Owner answers, and no Agent is made until then. Leaving
// returns to ?new=agent, where the composer takes the focus. Every way out plays the dialog's leave first and moves the
// page after it (#130; design-reference: closeModal, tpl-open); the scrim stays until the leave ends. It loads in its
// own chunk with its strings (ready-made.en.json and ready-made.ar.json).
export default function ReadyMade({slug,company,agent,companyName,alone,lead,roles,owner,owners}:{slug:string,company:string,agent:string,companyName:string,alone:boolean,lead:string,roles:ReadyRole[],owner:boolean,owners:string[]}) {
 const {t:say,language}=useI18n(); const text:Record<string,string>=language==='ar'?arText:enText;
 const t=(key:string,...values:string[])=>text[key].replace(/\{(\d+)\}/g,(whole,index:string)=>values[Number(index)]??whole);
 const router=useRouter(); const search=useRef<HTMLInputElement>(null);
 // A Member who is not the Owner asks Lead for the role: the Owner alone adds one (design-reference: tplCardHTML).
 const ask=!owner;
 const ownerNames=owners.length?new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(owners):'';
 const leaving=useLeave(); const [query,setQuery]=useState(''); const [category,setCategory]=useState<Category|'all'>('all');
 const [sending,setSending]=useState(false); const [failure,setFailure]=useState('');
 // One Conversation and send key per role picked, kept for a retry or a second click, so it is asked once.
 const picks=useRef<Partial<Record<string,{conversation:string,sendKey:string}>>>({});
 // A send still on its way when the gallery closes must not move the page that took its place.
 const active=useRef(true);
 useEffect(()=>{ active.current=true; return ()=>{ active.current=false; }; },[]);
 // The page moves once the gallery has left: a send that comes back meanwhile changes nothing.
 const leave=(to=`/c/${slug}/chat?new=agent`)=>{ active.current=false; leaving.close(()=>router.replace(to)); };
 // "Add it" for the Owner and "Ask for it" for a Member send the same message; Lead makes the Agent or prepares the
 // request, by the role the database gives the sender (lib/agent-tools.mjs, run_tools).
 async function add(role:ReadyRole) {
  // Nothing is asked once the gallery is leaving: what comes back could open nothing (the page is moving on).
  if(sending||!active.current) return;
  setSending(true); setFailure('');
  const pick=picks.current[role.id]??={conversation:newId(),sendKey:newId()};
  const failed=await postMessage({company,conversation:pick.conversation,agent,message:role.ask,sendKey:pick.sendKey});
  if(!active.current) return;
  if(!failed) return leave(`/c/${slug}/conversations/${pick.conversation}`);
  setFailure(failed); setSending(false);
 }
 // Once the leave has run the gallery is taken out at once, scrim and all, as the reference's dialog.close() does.
 if(leaving.gone) return null;
 const needle=query.trim().toLowerCase();
 const shown=roles.filter(role=>(category==='all'||role.category===category)&&role.search.includes(needle));
 return <Dialog open onOpenChange={next=>{if(!next) leave();}}>
  <DialogContent showCloseButton={false} className={`gw modal${leaving.closing?' is-closing':''}`} inert={leaving.closing||undefined} overlayClassName="gw-scrim-still" onOpenAutoFocus={event=>{event.preventDefault();search.current?.focus();}} onCloseAutoFocus={event=>event.preventDefault()}>
   <div className="modal__inner">
    <header className="modal__head">
     <div className="modal__titles"><DialogTitle className="modal__title">{t('title')} <bdi>{companyName}</bdi></DialogTitle>
      <DialogDescription className="modal__sub">{owner?(alone?t('subAlone',lead):t('subTeam',companyName)):ownerNames?t('subMember',lead,ownerNames,companyName):t('subMemberAnyOwner',lead,companyName)}</DialogDescription></div>
     <button type="button" className="circle-btn" aria-label={t('close')} onClick={()=>leave()}><ShellIcon name="x"/></button>
    </header>
    <div className="modal__tools">
     <label className="tpl-search"><ShellIcon name="search"/><span className="sr-only">{t('search')}</span><input ref={search} id="tpl-q" type="search" autoComplete="off" placeholder={t('searchHint')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
     <div className="tpl-cats" role="group" aria-label={t('categories')}>{(['all',...order.filter(kind=>roles.some(role=>role.category===kind))] as const).map(kind=>
      <button key={kind} type="button" className="chip" aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{t(`category.${kind}`)}<span className="chip__n">{roles.filter(role=>kind==='all'||role.category===kind).length}</span></button>)}</div>
     {failure&&<p role="alert" className="composer-error">{say(failure)}</p>}
    </div>
    {/* Each role's face is the look its Agent would be made with now (lib/ready-roles: readyRoleLooks). */}
    <LooksProvider looks={{agents:Object.fromEntries(roles.map(role=>[`ready-${role.id}`,role.look])),requests:{},removed:{}}}><div className="tpl-grid" aria-live="polite">{shown.length?shown.map(role=><article key={role.id} className="tpl" aria-labelledby={`tpl-t-${role.id}`}>
     <div className="tpl__top"><span className="tpl__face" aria-hidden="true"><AgentFace agent={`ready-${role.id}`} size={44}/></span>
      <div className="tpl__titles"><h3 className="tpl__role" id={`tpl-t-${role.id}`}>{role.role}</h3><span className="tpl__cat">{t(`category.${role.category}`)}{alone?'':` · ${t('team')}`}</span></div></div>
     <p className="tpl__line">{role.line}</p>
     {role.handoff&&<p className="tpl__hand"><ShellIcon name="hand"/><span>{role.handoff}</span></p>}
     <div className="tpl__foot">
      {/* The tiles draw the apps (design-reference: tplCardHTML); a screen reader reads their names. */}
      <span className="tpl__tools">{role.apps.length?<>{role.apps.map(app=><AppTile key={app.key} app={app}/>)}<span className="tpl__apps sr-only">{role.apps.map((app,index)=><Fragment key={app.key}>{index>0&&' · '}<bdi>{app.name}</bdi></Fragment>)}</span></>:<span className="tpl__none">{t('noApps')}</span>}</span>
      <button type="button" className="btn btn--secondary btn--sm" aria-label={ask?t('askLabel',role.role):t('addLabel',role.role)} disabled={sending} onClick={()=>void add(role)}>{ask?t('askIt'):t('add')}</button>
     </div>
    </article>):<div className="tpl-empty"><b>{needle?t('noMatch',query.trim()):t('noneHere')}</b><span>{t('emptyHint')}</span>
     <div className="tpl-empty__acts">{needle&&<button type="button" className="btn btn--secondary btn--sm" onClick={()=>{setQuery('');search.current?.focus();}}>{t('clear')}</button>}
      <button type="button" className="btn btn--secondary btn--sm" onClick={()=>leave()}>{ask?t('askLead',lead):t('scratch')}</button></div></div>}</div></LooksProvider>
    <footer className="modal__foot"><span className="modal__foot-t">{t('notFound')}</span><button type="button" className="btn btn--secondary" onClick={()=>leave()}>{ask?t('askLead',lead):t('scratch')}</button></footer>
   </div>
  </DialogContent>
 </Dialog>;
}
