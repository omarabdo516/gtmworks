'use client';
import { useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { inviteError } from '@/lib/invite.mjs';
import { SettingsIcon } from './settings-icons';
import { toast } from './toast';

export type InviteRole={key:string,name:string,description:string};
type Send=(email:string,role:string)=>Promise<{error?:string}>;
type Form={open:false}|{open:true,email:string,role:string,error:string,pending:boolean};
type Step={type:'open'}|{type:'close'}|{type:'email',email:string}|{type:'role',role:string}|{type:'fail',error:string}|{type:'send'}|{type:'sent'};

const fresh:Form={open:true,email:'',role:'contributor',error:'',pending:false};
// A Company worked alone keeps the form open (design-reference: sovCompanyHTML's solo branch); the Team table opens it
// with "Invite a member" and closes it with Cancel or a send (teamTableHTML, invite-toggle).
function step(alone:boolean) {
 return (form:Form,action:Step):Form=>{
  if(action.type==='open') return fresh;
  if(action.type==='close'||action.type==='sent') return alone?fresh:{open:false};
  if(!form.open) return form;
  switch(action.type) {
   // The error leaves as soon as the email is right (design-reference: the inv-email input handler).
   case 'email': return {...form,email:action.email,error:form.error&&!inviteError(action.email)?'':form.error};
   case 'role': return {...form,role:action.role};
   case 'fail': return {...form,error:action.error,pending:false};
   case 'send': return {...form,error:'',pending:true};
  }
 };
}

// An email inside the message stays one left-to-right run (design-reference: errH).
const isolateEmails=(text:string):ReactNode[]=>text.split(/([\w.+-]+@[\w.-]+)/).map((part,index)=>index%2?<bdi key={index} dir="ltr">{part}</bdi>:part);

// "Invite a member" in Company settings (#185), for the Owner. It takes its send as a prop, so its component test
// renders it with no server action.
export function InviteSection({mode,roles,send}:{mode:'table'|'alone',roles:InviteRole[],send:Send}) {
 const {t}=useI18n(); const router=useRouter();
 const alone=mode==='alone';
 const [form,dispatch]=useReducer(useMemo(()=>step(alone),[alone]),alone?fresh:{open:false});
 const focusNext=useRef<'inv-email'|'inv-toggle'|null>(null);
 useEffect(()=>{ if(focusNext.current) { document.getElementById(focusNext.current)?.focus(); focusNext.current=null; } });
 const go=(action:Step,focus:'inv-email'|'inv-toggle')=>{ focusNext.current=focus; dispatch(action); };
 const submit=async()=>{
  if(!form.open||form.pending) return;
  const email=form.email.trim();
  const wrong=inviteError(email);
  if(wrong) { go({type:'fail',error:wrong},'inv-email'); return; }
  dispatch({type:'send'});
  const {error}=await send(email,form.role);
  if(error) { go({type:'fail',error},'inv-email'); return; }
  toast(t('settingsInviteSent',email));
  go({type:'sent'},alone?'inv-email':'inv-toggle');
  router.refresh();
 };
 const chosen=form.open?roles.find(item=>item.key===form.role)||roles[0]:undefined;
 const fields=form.open&&chosen&&<form className="inv" noValidate onSubmit={event=>{event.preventDefault(); void submit();}}>
  <div className="inv-row">
   <div className="set-field"><label className="set-label" htmlFor="inv-email">{t('settingsInviteEmail')} <span aria-hidden="true">*</span></label>
    <input className="set-input" id="inv-email" type="email" dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('settingsInviteEmailExample')} value={form.email}
     aria-required="true" aria-describedby="inv-email-err" aria-invalid={form.error?true:undefined} onChange={event=>dispatch({type:'email',email:event.target.value})}/>
    <span className="set-err" id="inv-email-err" hidden={!form.error}>{form.error&&isolateEmails(t(form.error))}</span></div>
   <div className="set-field"><label className="set-label" htmlFor="inv-role">{t('settingsRole')}</label>
    <select className="set-input" id="inv-role" aria-describedby="inv-role-d" value={form.role} onChange={event=>dispatch({type:'role',role:event.target.value})}>{roles.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></div>
   <button type="submit" className="btn btn--primary inv-go" disabled={form.pending}>{t('settingsInviteGo')}</button>
  </div>
  <p className="set-hint" id="inv-role-d">{chosen.name}: {chosen.description}</p>
 </form>;
 if(alone) return <section className="inv-sec" aria-labelledby="inv-h"><h4 className="dp-label" id="inv-h"><span>{t('settingsInvite')}</span></h4>{fields}</section>;
 return <section className="inv-sec" aria-labelledby="inv-h">{form.open
  ?<><h3 className="dp-label" id="inv-h"><span>{t('settingsInvite')}</span><button type="button" className="link-btn" id="inv-toggle" onClick={()=>go({type:'close'},'inv-toggle')}>{t('cancel')}</button></h3>{fields}</>
  :<><h3 className="sr-only" id="inv-h">{t('settingsInvite')}</h3><button type="button" className="btn btn--secondary inv-open" id="inv-toggle" onClick={()=>go({type:'open'},'inv-email')}><SettingsIcon name="plus"/><span>{t('settingsInvite')}</span></button></>}
 </section>;
}
