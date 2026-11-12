'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';

// crypto.randomUUID needs a secure context; an install reached over plain http still gets a v4 id.
export const newId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

// The reference's composer (design-reference: composerHTML): one rounded box, the text and the send arrow.
// One send key per typed message, so a double click or a retry runs once; a new text gets a new key.
export function MessageBox({placeholder,send}:{placeholder:string,send:(text:string,sendKey:string)=>Promise<string|null>}) {
 const {t}=useI18n(); const [text,setText]=useState(''); const [key,setKey]=useState(newId); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function submit() {
  if(!text.trim()||busy) return;
  setBusy(true); setError('');
  const failure=await send(text,key);
  setBusy(false);
  if(failure) setError(failure); else { setText(''); setKey(newId()); }
 }
 return <div className="composer">
  <div className="composer__row">
   <textarea className="composer__input" dir="auto" rows={1} readOnly={busy} aria-busy={busy} aria-label={t('conversationMessage')} placeholder={placeholder} value={text} onChange={event=>{setText(event.target.value);setKey(newId());}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/>
   <button type="button" className="composer__send" aria-label={t('conversationSend')} disabled={!text.trim()||busy} onClick={()=>void submit()}><ShellIcon name="send"/></button>
  </div>
  {error&&<p role="alert" className="composer-error">{t(error)}</p>}
 </div>;
}

export async function postMessage(body:object) {
 try {
  const response=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.ok?null:((await response.json()).error as string)||'conversationFailed';
 } catch { return 'conversationFailed'; }
}
