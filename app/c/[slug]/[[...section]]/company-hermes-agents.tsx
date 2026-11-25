'use client';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/paperclip/ui/dropdown-menu';

type Agent={id:string,connection_id:string,name:string,speciality:string,is_default:boolean};
function AgentPicker({name,label,choices}:{name:string,label:string,choices:{id:string,name:string,faceId:string}[]}) {
 const {t,language}=useI18n(); const [value,setValue]=useState(''); const selected=choices.find(choice=>choice.id===value);
 return <><input type="hidden" name={name} value={value}/><DropdownMenu dir={language==='ar'?'rtl':'ltr'}>
  <DropdownMenuTrigger asChild><button className="member-picker" type="button" aria-label={label}>{selected&&<AgentFace agent={selected.id} size={24}/>}<bdi>{selected?.name||t('hermesChooseAgent')}</bdi></button></DropdownMenuTrigger>
  <DropdownMenuContent className="max-w-[var(--radix-dropdown-menu-content-available-width)]" align="start"><DropdownMenuRadioGroup value={value} onValueChange={setValue}>
   {choices.map(choice=><DropdownMenuRadioItem className={language==='ar'?'member-option pl-2 pr-8 [&>span]:left-auto [&>span]:right-2':'member-option'} key={choice.id} value={choice.id} textValue={choice.name}><AgentFace agent={choice.id} size={24}/><bdi className="min-w-0 break-words">{choice.name}</bdi></DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup></DropdownMenuContent>
 </DropdownMenu></>;
}
// The Company's Agents on its own Engine (#342: no Agent is attached by hand): an Owner picks the main one or removes one.
export default function CompanyHermesAgents({company,owner,initial}:{company:string,owner:boolean,initial:Agent[]}) {
 const {t}=useI18n(); const [agents,setAgents]=useState(initial); const [error,setError]=useState(''); const [pending,setPending]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form=event.currentTarget; const fields=Object.fromEntries([...new FormData(form)].filter(([,value])=>value!==''));
  setPending(true); setError('');
  try {
   const response=await fetch('/api/hermes-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,company})});
   const result=await response.json();
   if(!response.ok) { setError(result.error); return; }
   setAgents(result.agents); form.reset();
  } catch { setError('hermesAgentFailed'); } finally { setPending(false); }
 }
 return <section className="panel agents-panel company-hermes-agents" aria-label={t('hermesCompanyAgents')}>
  <h2>{t('hermesCompanyAgents')}</h2><p>{t('hermesDefaultHelp')}</p>
  {error&&<p role="alert">{t(error)}</p>}
  <div className="detail-rows">{agents.length===0?<p className="empty">{t('noAgentsYet')}</p>:agents.map(agent=><div className="detail-row flex-wrap" key={agent.id}>
   <div className="flex flex-1 items-center gap-3"><AgentFace agent={agent.id} size={24}/><div className="agent-row-main"><strong dir="auto" className="break-words">{agent.name}</strong><p dir="auto">{agent.speciality}</p>{agent.is_default&&<p>{t('hermesDefaultAgent')}</p>}</div></div>
   {owner&&<div className="stack w-full sm:w-auto">{!agent.is_default&&<form onSubmit={submit}><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value="default"/><button className="button" disabled={pending}>{t('hermesMakeDefault')}</button></form>}
    <form onSubmit={submit} className="agent-webhook-form"><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value="remove"/>
     {agent.is_default&&agents.length>1&&<div><p>{t('hermesNextDefault')}</p><AgentPicker name="replacement" label={t('hermesNextDefault')} choices={agents.filter(next=>next.id!==agent.id).map(next=>({id:next.id,name:next.name,faceId:next.connection_id}))}/></div>}
     <button className="button" disabled={pending} aria-label={t('hermesRemoveAgentNamed',agent.name)}>{t('hermesRemoveAgent')}</button>
    </form></div>}
  </div>)}</div>
 </section>;
}
