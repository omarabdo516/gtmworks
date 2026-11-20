'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';

// Update now (#443, ADR 0020), for an Owner: the state the updater on the host writes, read from /api/install-update,
// and, where a newer version is offered (`offer`), the button that asks for it. The app only records the request; while
// the update runs gtmworks is down for about a minute, so the state is read again every few seconds until the updater
// says how it ended. Anyone else reads nothing and sees nothing; a failed read shows nothing.
export type InstallUpdateState = { button: boolean, state: 'idle'|'requested'|'updating'|'updated'|'failed', version: string|null, changedAt: string };
const seenKey='gtmworks-update-seen';
// Said by the instance that recorded a request, so the sidebar's own line reads the state again and shows Updating.
const asked='gtmworks:update-asked';
const poll=5000;
// A release by its tag; a main build by the start of its digest.
const versionName=(version:string|null)=>version?.startsWith('main@sha256:')?`main · ${version.slice(12,19)}`:version||'';
const running=(state?:InstallUpdateState['state'])=>state==='requested'||state==='updating';
// The state, null for anyone it is not for, or undefined when gtmworks did not answer (down while it updates).
async function readState():Promise<InstallUpdateState|null|undefined> {
 try {
  const response=await fetch('/api/install-update',{cache:'no-store'});
  if(response.ok) return await response.json() as InstallUpdateState|null;
  return response.status===401?null:undefined;
 } catch { return undefined; }
}

export default function InstallUpdate({offer=false,initial,onAsked}:{offer?:boolean,initial?:InstallUpdateState|null,onAsked?:()=>void}) {
 const {t}=useI18n();
 const [update,setUpdate]=useState<InstallUpdateState|null|undefined>(initial);
 // Drawn in the browser only (the state is read there), so the result an Owner closed is known from the first render.
 const [seen,setSeen]=useState<string|null>(()=>{ try { return localStorage.getItem(seenKey); } catch { return null; } });
 const [asking,setAsking]=useState(false);
 const [pending,setPending]=useState(false);
 const [problem,setProblem]=useState<'updateRequestFailed'|'updateButtonOff'|'updateFailedRecently'|null>(null);
 // Read on mount, and on a steady beat while an update runs: a read that fails while gtmworks is down changes nothing, and
 // the next one asks again.
 useEffect(()=>{
  if(initial!==undefined) return;
  let live=true;
  void readState().then(state=>{ if(live&&state!==undefined) setUpdate(state); });
  return ()=>{ live=false; };
 },[initial]);
 useEffect(()=>{
  const again=()=>void readState().then(state=>{ if(state!==undefined) setUpdate(state); });
  window.addEventListener(asked,again);
  return ()=>window.removeEventListener(asked,again);
 },[]);
 const updating=running(update?.state);
 useEffect(()=>{
  if(!updating) return;
  const timer=setInterval(()=>void readState().then(state=>{ if(state!==undefined) setUpdate(state); }),poll);
  return ()=>clearInterval(timer);
 },[updating]);
 if(!update) return null;
 const dismiss=()=>{ try { localStorage.setItem(seenKey,update.changedAt); } catch { /* shown again next time */ } setSeen(update.changedAt); };
 const ask=async()=>{
  setPending(true); setProblem(null);
  try {
   const response=await fetch('/api/install-update',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   const body=await response.json().catch(()=>({})) as {state?:InstallUpdateState['state'],error?:string};
   if(response.ok&&body.state) { setAsking(false); setUpdate({...update,state:body.state,changedAt:new Date().toISOString()}); window.dispatchEvent(new Event(asked)); onAsked?.(); }
   else setProblem(body.error==='updateButtonOff'||body.error==='updateFailedRecently'?body.error:'updateRequestFailed');
  } catch { setProblem('updateRequestFailed'); }
  setPending(false);
 };
 const result=(update.state==='updated'||update.state==='failed')&&seen!==update.changedAt;
 const canAsk=offer&&update.button&&!running(update.state);
 if(!running(update.state)&&!result&&!canAsk&&!problem) return null;
 return <div className="install-update" aria-live="polite">
  {running(update.state)&&<p className="install-update__line" role="status">{t('updating')}</p>}
  {result&&update.state==='updated'&&<p className="install-update__line" role="status">{t('updatedTo',versionName(update.version))}{' '}
   <button type="button" className="link-btn" onClick={()=>{ dismiss(); location.reload(); }}>{t('updateReload')}</button>{' '}
   <button type="button" className="link-btn" onClick={dismiss}>{t('close')}</button></p>}
  {result&&update.state==='failed'&&<p className="install-update__line set-err" role="alert">{update.version?t('updateFailed',versionName(update.version)):t('updateFailedUnknown')}{' '}
   <button type="button" className="link-btn" onClick={dismiss}>{t('close')}</button></p>}
  {canAsk&&!asking&&<button type="button" className="btn btn--primary" onClick={()=>setAsking(true)}>{t('updateNow')}</button>}
  {canAsk&&asking&&<div className="install-update__ask" role="group" aria-label={t('updateNow')}>
   <p className="install-update__line">{t('updateNowAsk')}</p>
   <div className="panel-form__row panel-form__row--end">
    <button type="button" className="btn btn--secondary" disabled={pending} onClick={()=>setAsking(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" aria-busy={pending} disabled={pending} onClick={ask}>{t('updateNow')}</button>
   </div></div>}
  {problem&&<p className="install-update__line set-err" role="alert">{t(problem)}</p>}
 </div>;
}
