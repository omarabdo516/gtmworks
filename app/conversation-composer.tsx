'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ChevronDown, Lock, SquarePen } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/paperclip/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/paperclip/ui/dropdown-menu';

type Agent={id:string,connection_id:string,name:string,is_default:boolean};
// crypto.randomUUID needs a secure context; an install reached over plain http still gets a v4 id.
export const newId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

// One send key per typed message, so a double click or a retry runs once; a new text gets a new key.
export function MessageBox({placeholder,rows,send,children}:{placeholder:string,rows:number,send:(text:string,sendKey:string)=>Promise<string|null>,children?:ReactNode}) {
 const {t}=useI18n(); const [text,setText]=useState(''); const [key,setKey]=useState(newId); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function submit() {
  if(!text.trim()||busy) return;
  setBusy(true); setError('');
  const failure=await send(text,key);
  setBusy(false);
  if(failure) setError(failure); else { setText(''); setKey(newId()); }
 }
 return <div className="composer">
  {children}
  <textarea dir="auto" rows={rows} readOnly={busy} aria-busy={busy} aria-label={t('conversationMessage')} placeholder={placeholder} value={text} onChange={event=>{setText(event.target.value);setKey(newId());}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/>
  {error&&<p role="alert" className="composer-error">{t(error)}</p>}
  <div className="composer-bar"><span className="grow"/><button type="button" className="send" aria-label={t('conversationSend')} disabled={!text.trim()||busy} onClick={()=>void submit()}><ArrowUp className="h-5 w-5" aria-hidden="true"/></button></div>
 </div>;
}

export async function postMessage(body:object) {
 try {
  const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.ok?null:((await response.json()).error as string)||'conversationFailed';
 } catch { return 'conversationFailed'; }
}

export function NewConversation({slug,company,mobile=false}:{slug:string,company:string,mobile?:boolean}) {
 const {t,language}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(false); const [agency,setAgency]=useState<boolean|null>(null); const [agents,setAgents]=useState<Agent[]|null>(null); const [chosen,setChosen]=useState(''); const [conversation,setConversation]=useState(newId);
 async function load(next:boolean) {
  setOpen(next); if(!next) return;
  setConversation(newId()); setAgents(null);
  try {
   const response=await fetch(`/api/conversations?company=${company}`,{cache:'no-store'});
   const result=response.ok?await response.json():{agency:false,agents:[]};
   const list=result.agents as Agent[];
   setAgency(result.agency); setAgents(list); setChosen(list.find(agent=>agent.is_default)?.id||list[0]?.id||'');
  } catch { setAgency(true); setAgents([]); }
 }
 const agent=agents?.find(item=>item.id===chosen);
 const trigger=mobile?<button type="button" data-slot="new-conversation" className="relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"><SquarePen className="h-[18px] w-[18px]" aria-hidden="true"/><span className="truncate">{t('conversationNew')}</span></button>
  :<button type="button" data-slot="new-conversation" className="new-conversation-action"><SquarePen className="icon h-4 w-4" aria-hidden="true"/>{t('conversationNew')}</button>;
 return <Dialog open={open} onOpenChange={next=>void load(next)}>
  <DialogTrigger asChild>{trigger}</DialogTrigger>
  <DialogContent aria-describedby={undefined} className="conversation-dialog sm:max-w-[640px] gap-0 p-0">
   <DialogTitle className="dlg-title">{t('conversationNewTitle')}</DialogTitle>
   {agents===null?<p className="composer-note" role="status">{t('conversationLoadingAgents')}</p>
    :!agency?<p className="composer-note" role="note">{t('conversationAgencyOnlyHelp')}</p>
    :!agent?<p className="composer-note" role="note">{t('conversationNoAgent')}</p>
    :<><div className="dlg-head"><DropdownMenu dir={language==='ar'?'rtl':'ltr'}>
      <DropdownMenuTrigger asChild><button type="button" className="pill" aria-label={t('conversationAgent')}><AgentFace id={agent.connection_id} role="account_manager" name={agent.name} size={20}/><bdi>{agent.name}</bdi><ChevronDown className="h-3.5 w-3.5" aria-hidden="true"/></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={chosen} onValueChange={setChosen}>
       {agents.map(item=><DropdownMenuRadioItem className={language==='ar'?'member-option pl-2 pr-8 [&>span]:left-auto [&>span]:right-2':'member-option'} key={item.id} value={item.id} textValue={item.name}><AgentFace id={item.connection_id} role="account_manager" name={item.name}/><bdi>{item.name}</bdi></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup></DropdownMenuContent>
     </DropdownMenu></div>
     <MessageBox rows={5} placeholder={t('conversationPlaceholder')} send={async(message,sendKey)=>{
      const failure=await postMessage({company,conversation,agent:agent.id,message,sendKey});
      if(!failure) { setOpen(false); router.push(`/c/${slug}/conversations/${conversation}`); }
      return failure;
     }}/>
     <p className="dlg-foot-note"><Lock className="h-3.5 w-3.5" aria-hidden="true"/>{t('conversationPrivate')}<span className="ms-auto">{t('conversationEnterHint')}</span></p></>}
  </DialogContent>
 </Dialog>;
}
