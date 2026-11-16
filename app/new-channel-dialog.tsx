'use client';
import './new-channel.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/paperclip/ui/dialog';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { newId } from '@/app/conversation-composer';
import { channelChoices, createChannel } from '@/app/channel-actions';
import channelEn from '@/lib/messages/channel.en.json';
import channelAr from '@/lib/messages/channel.ar.json';

type Choices=NonNullable<Awaited<ReturnType<typeof channelChoices>>>;
type NameError=''|'channelNameMissing'|'channelNameTaken'|'channelCreateFailed';
// The name as the channel list will show it: without the '#' or the spaces typed around it.
const bare=(name:string)=>name.trim().replace(/^#+/,'').trim();

// design-reference: teamCreateHTML. One request key for the dialog's life, so a retried Create makes one channel.
export default function NewChannelDialog({slug,company,person,close}:{slug:string,company:string,person:string,close:()=>void}) {
 const {t,language}=useI18n(); const own:Record<string,string>=language==='ar'?channelAr:channelEn;
 const c=(key:string,...values:unknown[])=>own[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const router=useRouter(); const field=useRef<HTMLInputElement>(null); const key=useRef(newId());
 const [choices,setChoices]=useState<Choices|null>(null);
 const [name,setName]=useState(''); const [error,setError]=useState<NameError>('');
 const [people,setPeople]=useState<string[]>([]); const [agents,setAgents]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 useEffect(()=>{ let live=true; void channelChoices(company).then(found=>{ if(live) setChoices(found); }); return ()=>{live=false;}; },[company]);
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(item=>item!==id):[...list,id];
 const nameError=error==='channelNameMissing'||error==='channelNameTaken';
 async function create() {
  if(saving) return;
  if(!bare(name)) { setError('channelNameMissing'); field.current?.focus(); return; }
  setSaving(true); setError('');
  let made:Awaited<ReturnType<typeof createChannel>>;
  try { made=await createChannel(company,{key:key.current,name,people,agents}); }
  catch { setSaving(false); setError('channelCreateFailed'); return; }
  if('channel' in made) { close(); router.push(`/c/${slug}/channels/${made.channel}`); return; }
  setSaving(false);
  const {refused}=made;
  if(refused==='channelNameTaken'||refused==='channelNameMissing') { setError(refused); field.current?.focus(); }
  else setError('channelCreateFailed');
 }
 const chosen=new Set([person,...people]);
 const pool=choices?.agents||[];
 const [before,after]=own.channelCreateTip.split('@{0}');
 return <Dialog open onOpenChange={next=>{if(!next) close();}}>
  <DialogContent showCloseButton={false} className="gw modal modal--sm" onOpenAutoFocus={event=>{event.preventDefault();field.current?.focus();}}>
   <div className="modal__inner">
    <header className="modal__head">
     <div className="modal__titles"><DialogTitle className="modal__title">{t('shellNewChannel')}</DialogTitle>
      <DialogDescription className="modal__sub">{c('channelNewSub')}</DialogDescription></div>
     <button type="button" className="circle-btn" aria-label={c('channelClose')} data-close onClick={close}><ShellIcon name="x"/></button>
    </header>
    <div className="modal__body cr">
     <div className="set-field"><label className="set-label" htmlFor="tm-name">{c('channelName')} <span aria-hidden="true">*</span></label>
      <input ref={field} className="set-input" id="tm-name" type="text" maxLength={32} autoComplete="off" value={name} placeholder={c('channelNameExample')} aria-required="true"
       aria-describedby="tm-name-err tm-name-hint" aria-invalid={nameError||undefined} dir="auto"
       onChange={event=>{setName(event.target.value);if(event.target.value.trim()&&nameError) setError('');}}
       onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing) {event.preventDefault();void create();}}}
       onBlur={event=>{if(!event.target.value.trim()&&!(event.relatedTarget as HTMLElement|null)?.closest('[data-close]')) setError('channelNameMissing');}}/>
      <span className="set-err" id="tm-name-err" hidden={!nameError}>{error==='channelNameTaken'?c('channelNameTaken'):c('channelNameMissing')}</span>
      <span className="set-hint" id="tm-name-hint">{c('channelNameShows',bare(name)||c('channelNameSample'))}</span></div>
     <div className="set-field"><span className="set-label" id="ch-pick-l">{t('members')} <span className="num">{chosen.size}</span></span>
      <div className="panel-card" role="group" aria-labelledby="ch-pick-l">{(choices?.people||[]).map(member=>{
       const self=member.person===person; const on=chosen.has(member.person);
       return <button key={member.person} type="button" className="panel-row tm-pick" role="checkbox" id={`ch-pick-${member.person}`} aria-checked={on} aria-disabled={self||undefined}
        onClick={()=>{if(!self) setPeople(list=>toggle(list,member.person));}}>
        <Initial name={member.name}/>
        <span className="panel-row__text"><span className="panel-row__t"><bdi>{member.name}</bdi>{self&&<> <span className="ch-you">{c('channelYou')}</span></>}</span>
         <span className="panel-row__d">{self?c('channelCreatorIn'):<>{t(member.role)}{member.role==='viewer'&&` · ${c('channelWillOnlyRead')}`}</>}</span></span>
        <span className="tm-check" aria-hidden="true">{on&&<ShellIcon name="check"/>}</span></button>;
      })}</div></div>
     <div className="set-field"><span className="set-label" id="tm-pick-l">{c('channelAgentsIn')} <span className="num">{agents.length}</span></span>
      <div className="panel-card" role="group" aria-labelledby="tm-pick-l">{pool.map(agent=>{
       const on=agents.includes(agent.id);
       return <button key={agent.id} type="button" className="panel-row tm-pick" role="checkbox" id={`tm-pick-${agent.id}`} aria-checked={on} onClick={()=>setAgents(list=>toggle(list,agent.id))}>
        <span aria-hidden="true"><CompanyAgentFace agent={agent} size={28}/></span>
        <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span><span className="panel-row__d"><bdi>{agent.speciality||t('newAgent')}</bdi></span></span>
        <span className="tm-check" aria-hidden="true">{on&&<ShellIcon name="check"/>}</span></button>;
      })}</div></div>
     <p className="set-hint cr-hint"><ShellIcon name="at"/> {pool[0]?<>{before}<bdi>@{pool[0].name}</bdi>{after}</>:c('channelCreateTipPlain')}</p>
     {error==='channelCreateFailed'&&<p className="set-err" role="alert">{c('channelCreateFailed')}</p>}
    </div>
    <footer className="modal__foot modal__foot--end">
     <button type="button" className="btn btn--secondary" data-close onClick={close}>{t('cancel')}</button>
     <button type="button" className="btn btn--primary" disabled={saving} onClick={()=>void create()}>{c('channelCreate')}</button>
    </footer>
   </div>
  </DialogContent>
 </Dialog>;
}

const Initial=({name}:{name:string})=><span className="me__av lg-av" style={{'--av':'28px'} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;
