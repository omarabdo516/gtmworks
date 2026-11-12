'use client';
import { useState, type FormEvent } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/paperclip/ui/dropdown-menu';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean};
type Connection={id:string,address:string,profile:string};
function AgentPicker({name,label,choices,onChange}:{name:string,label:string,choices:{id:string,name:string,faceId:string}[],onChange?:()=>void}) {
 const {t,language}=useI18n(); const [value,setValue]=useState(''); const selected=choices.find(choice=>choice.id===value);
 return <><input type="hidden" name={name} value={value}/><DropdownMenu dir={language==='ar'?'rtl':'ltr'}>
  <DropdownMenuTrigger asChild><button className="member-picker" type="button" aria-label={label}>{selected&&<AgentFace id={selected.faceId} role="account_manager" name={selected.name}/>}<bdi>{selected?.name||t('hermesChooseAgent')}</bdi></button></DropdownMenuTrigger>
  <DropdownMenuContent className="max-w-[var(--radix-dropdown-menu-content-available-width)]" align="start"><DropdownMenuRadioGroup value={value} onValueChange={next=>{setValue(next);onChange?.();}}>
   {choices.map(choice=><DropdownMenuRadioItem className={language==='ar'?'member-option pl-2 pr-8 [&>span]:left-auto [&>span]:right-2':'member-option'} key={choice.id} value={choice.id} textValue={choice.name}><AgentFace id={choice.faceId} role="account_manager" name={choice.name}/><bdi className="min-w-0 break-words">{choice.name}</bdi></DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup></DropdownMenuContent>
 </DropdownMenu></>;
}
export default function CompanyHermesAgents({company,slug,agency,initial,connections}:{company:string,slug:string,agency:boolean,initial:Agent[],connections:Connection[]}) {
 const {t}=useI18n(); const [agents,setAgents]=useState(initial); const [error,setError]=useState(''); const [sharing,setSharing]=useState(false); const [pending,setPending]=useState(false); const [profileChosen,setProfileChosen]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form=event.currentTarget; const fields=Object.fromEntries([...new FormData(form)].filter(([,value])=>value!==''));
  setPending(true); setError('');
  try {
   const response=await fetch('/api/hermes-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,company,makeDefault:fields.makeDefault==='on',confirmSharing:fields.confirmSharing==='on'})});
   const result=await response.json();
   if(!response.ok) { setError(result.error); if(result.error==='hermesSharingWarning') setSharing(true); return; }
   setAgents(result.agents); setSharing(false); if(fields.intent!=='default') setProfileChosen(false); form.reset();
  } catch { setError('hermesAgentFailed'); } finally { setPending(false); }
 }
 return <section className="panel agents-panel company-hermes-agents" aria-label={t('hermesCompanyAgents')}>
  <h2>{t('hermesCompanyAgents')}</h2><p>{t('hermesDefaultHelp')}</p>
  {error&&<p role="alert">{t(error)}</p>}
  <div className="detail-rows">{agents.length===0?<p className="empty">{t('noAgentsYet')}</p>:agents.map(agent=><div className="detail-row flex-wrap" key={agent.id}>
   <div className="flex flex-1 items-center gap-3"><AgentFace id={agent.connection_id} role="account_manager" name={agent.name}/><div className="agent-row-main"><strong dir="auto" className="break-words">{agent.name}</strong><p dir="auto">{agent.speciality}</p>{agent.is_default&&<p>{t('hermesDefaultAgent')}</p>}</div></div>
   {agency&&<div className="stack w-full sm:w-auto">{!agent.is_default&&<form onSubmit={submit}><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value="default"/><button className="button" disabled={pending}>{t('hermesMakeDefault')}</button></form>}
    <form onSubmit={submit} className="agent-webhook-form"><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value="remove"/>
     {agent.is_default&&agents.length>1&&<div><p>{t('hermesNextDefault')}</p><AgentPicker name="replacement" label={t('hermesNextDefault')} choices={agents.filter(next=>next.id!==agent.id).map(next=>({id:next.id,name:next.name,faceId:next.connection_id}))}/></div>}
     <button className="button" disabled={pending} aria-label={t('hermesRemoveAgentNamed',agent.name)}>{t('hermesRemoveAgent')}</button>
    </form></div>}
  </div>)}</div>
  {agency&&<>{connections.length?<form key={agents.map(agent=>agent.id).join(':')} className="agent-webhook-form" onSubmit={submit}>
   <input type="hidden" name="intent" value="attach"/>
   <div><p>{t('hermesConnectedProfile')}</p><AgentPicker name="connection" label={t('hermesConnectedProfile')} choices={connections.map(connection=>({id:connection.id,name:`${connection.profile} — ${connection.address}`,faceId:connection.id}))} onChange={()=>{setProfileChosen(true);setSharing(false);setError('');}}/></div>
   <label>{t('hermesAgentName')}<input className="field" name="name" dir="auto" maxLength={100} required/></label>
   <label>{t('hermesSpeciality')}<input className="field" name="speciality" dir="auto" maxLength={200} required/></label>
   <label className="min-h-11"><input className="me-2" type="checkbox" name="makeDefault"/>{t('hermesMakeDefault')}</label>
   {sharing&&<label className="min-h-11"><input className="me-2" type="checkbox" name="confirmSharing" required/>{t('hermesSharingWarning')}</label>}
   <button className="button" disabled={pending||!profileChosen}>{t('hermesAttachAgent')}</button>
  </form>:<p>{t('hermesConnectFirst')}</p>}<Link className="link" href={`/c/${slug}/settings/agents`}>{t('hermesConnection')}</Link></>}
 </section>;
}
