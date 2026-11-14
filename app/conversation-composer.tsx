'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';

// crypto.randomUUID needs a secure context; an install reached over plain http still gets a v4 id.
export const newId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

// The reference's composer (design-reference: composerHTML): one rounded box with the extras button, the text, the
// microphone and the send arrow. Extras (attach, call an Agent, commands) and dictation are not built yet, so their
// buttons are drawn but say "Soon".
// One send key per typed message, so a double click or a retry runs once; a new text gets a new key.
// While the Agent works (design-reference: syncComposer), an empty box turns the send arrow into a stop square for a
// person allowed to stop the run (`stop`); typed text is still sent, and waits for the current reply.
export function MessageBox({placeholder,send,stop}:{placeholder:string,send:(text:string,sendKey:string)=>Promise<string|null>,stop?:{label:string,run:()=>Promise<string|null>}}) {
 const {t}=useI18n(); const [text,setText]=useState(''); const [key,setKey]=useState(newId); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 async function submit() {
  if(!text.trim()||busy) return;
  setBusy(true); setError('');
  const failure=await send(text,key);
  setBusy(false);
  if(failure) setError(failure); else { setText(''); setKey(newId()); }
 }
 async function halt({run}:{run:()=>Promise<string|null>}) {
  setBusy(true); setError('');
  const failure=await run();
  setBusy(false);
  if(failure) setError(failure);
 }
 return <div className="composer">
  <div className="composer__row">
   <button type="button" className="composer__btn" aria-disabled="true" aria-label={`${t('chatMore')} · ${t('soon')}`} title={t('soon')}><ShellIcon name="plus"/></button>
   <textarea className="composer__input" dir="auto" rows={1} readOnly={busy} aria-busy={busy} aria-label={t('conversationMessage')} placeholder={placeholder} value={text} onChange={event=>{setText(event.target.value);setKey(newId());}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/>
   <button type="button" className="composer__btn composer__mic" aria-disabled="true" aria-label={`${t('chatDictation')} · ${t('soon')}`} title={t('soon')}><ShellIcon name="mic"/></button>
   {stop&&!text.trim()?<button type="button" className="composer__send is-stop" aria-label={stop.label} title={stop.label} disabled={busy} onClick={()=>void halt(stop)}><ShellIcon name="stopFill"/></button>
   :<button type="button" className="composer__send" aria-label={t('conversationSend')} disabled={!text.trim()||busy} onClick={()=>void submit()}><ShellIcon name="send"/></button>}
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
