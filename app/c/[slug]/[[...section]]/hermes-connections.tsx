'use client';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { agentDate } from '@/lib/agent-date.mjs';
import type { HermesState } from '@/lib/hermes.mjs';

export type Connection=HermesState&{id:string,address:string,profile:string,unreachable_since:string|null};
export default function HermesConnections({company,agency,initial}:{company:string,agency:boolean,initial:Connection[]}) {
 const {t:translate,language}=useI18n(); const [connections,setConnections]=useState(initial); const [error,setError]=useState(''); const [pending,setPending]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form=event.currentTarget; const fields=Object.fromEntries(new FormData(form));
  const intent=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')||'save';
  setPending(true); setError('');
  try {
   const response=await fetch('/api/hermes-connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,company,intent})});
   const saved=await response.json();
   if(!response.ok) { setError(saved.error); return; }
   if(saved.connection) setConnections(previous=>[...previous.filter(connection=>connection.id!==saved.connection.id),saved.connection]);
   else setConnections(previous=>previous.filter(connection=>connection.id!==fields.id));
   form.reset();
  } catch { setError('hermesFailed'); }
  finally { const password=form.elements.namedItem('key'); if(password instanceof HTMLInputElement) password.value=''; setPending(false); }
 }
 const editor=(connection?:Connection)=><form className="agent-webhook-form" onSubmit={submit}>
  {connection&&<input type="hidden" name="id" value={connection.id}/>}
  <label>{translate('hermesAddress')}<input className="field" type="url" name="address" dir="ltr" defaultValue={connection?.address} required/></label>
  <label>{translate('hermesProfile')}<input className="field" name="profile" dir="auto" defaultValue={connection?.profile} pattern="[a-zA-Z0-9_-]+" maxLength={100} required/></label>
  <label>{translate('hermesKey')}<input className="field" type="password" name="key" autoComplete="new-password" maxLength={4096} required aria-describedby="hermes-key-help"/></label>
  <div className="flex flex-wrap gap-2"><button className="button" value="save" disabled={pending}>{translate(connection?'hermesReplace':'hermesSave')}</button>{connection&&<><button className="button" value="test" formNoValidate disabled={pending}>{translate('hermesTest')}</button><button className="button" value="remove" formNoValidate disabled={pending}>{translate('hermesRemove')}</button></>}</div>
 </form>;
 return <section className="panel agents-panel" aria-label={translate('hermesConnection')}>
  <h2>{translate('hermesConnection')}</h2><p id="hermes-key-help">{translate('hermesKeyHelp')}</p>
  {error&&<p role="alert">{translate(error)}</p>}
  {connections.map(connection=><div className="detail-row" key={connection.id}>
   <div className="agent-row-main"><strong dir="auto">{connection.profile}</strong><p role="status">{translate(`hermesState_${connection.state}`)}{connection.unreachable_since&&<> <time dateTime={connection.unreachable_since}>{agentDate(connection.unreachable_since,language)}</time></>}</p>
   {connection.version&&<p dir="auto">{translate('hermesVersion',connection.version)}</p>}{agency&&editor(connection)}</div>
  </div>)}
  {agency?editor():<p>{translate('hermesAgencyOnly')}</p>}
 </section>;
}
