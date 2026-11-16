'use client';
import { useState, useSyncExternalStore, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { closeTarget, overlayHref } from '@/lib/settings-overlay.mjs';
import { saveTheme } from './theme-actions';
import { saveLanguage } from './language-actions';
import { SettingsIcon } from './settings-icons';
import { openedFrom as storedFrom } from './settings-opener';
import { changeMember } from './c/[slug]/[[...section]]/actions';
import { setAgentVisible } from './agent-visibility-actions';
import { madeDay, useZone } from './agent-made';
import { dateFormatter, dayOf } from '@/lib/activity-log.mjs';
import { localeFor } from '@/lib/i18n.mjs';



export function CloseButton({slug}:{slug:string}) {
 const {t}=useI18n(); const router=useRouter();
 return <button type="button" className="circle-btn" id="sov-close" aria-label={t('settingsCloseLabel')} title={t('settingsCloseTitle')} onClick={()=>router.push(closeTarget(storedFrom(),slug))}><SettingsIcon name="x"/></button>;
}

// Arrow keys move between the choices of one radio group (WAI-ARIA radio pattern); the choice is made with Enter or Space.
function arrows(event:KeyboardEvent<HTMLElement>) {
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
 const items=[...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
 const at=items.indexOf(document.activeElement as HTMLElement); if(at<0) return;
 event.preventDefault();
 const forward=event.key==='ArrowDown'||(event.key==='ArrowLeft')===(document.documentElement.dir==='rtl');
 items[(at+(forward?1:-1)+items.length)%items.length].focus();
}

const darkQuery='(prefers-color-scheme: dark)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(darkQuery);media.addEventListener('change',notify);return ()=>media.removeEventListener('change',notify);};
const languages=[{key:'en',name:'languageNameEnglish',description:'languageEnglishDescription'},{key:'ar',name:'languageNameArabic',description:'languageArabicDescription'}] as const;

// "Your account": the look (Light or Dark, saved to the account; a saved "Device" shows what the system shows) and
// the interface language, each saved as soon as it is chosen.
export function AccountChoices({theme}:{theme:string}) {
 const {t,language}=useI18n();
 const systemDark=useSyncExternalStore(subscribe,()=>window.matchMedia(darkQuery).matches,()=>false);
 const dark=theme==='dark'||(theme==='device'&&systemDark);
 const [pending,startTransition]=useTransition();
 const [error,setError]=useState('');
 const save=(name:'theme'|'language',value:string)=>startTransition(async()=>{
  const form=new FormData(); form.set(name,value);
  setError(await (name==='theme'?saveTheme:saveLanguage)('',form));
 });
 return <>
  <section className="dp-sec" aria-labelledby="ac-h-th"><h4 className="dp-label" id="ac-h-th"><span>{t('settingsAppearance')}</span></h4>
   <div className="panel-card set-card"><div className="segmented segmented--field" role="radiogroup" aria-labelledby="ac-h-th" onKeyDown={arrows}>
    {(['light','dark'] as const).map(mode=>{const on=(mode==='dark')===dark; return <button key={mode} type="button" role="radio" id={`ac-th-${mode}`} aria-checked={on} tabIndex={on?0:-1} disabled={pending} onClick={()=>{ if(!on||theme==='device') save('theme',mode); }}>
     <SettingsIcon name={mode==='dark'?'moon':'sun'}/><span>{t(mode==='dark'?'settingsDark':'settingsLight')}</span></button>;})}
   </div></div></section>
  <section className="dp-sec" aria-labelledby="ac-h-lang"><h4 className="dp-label" id="ac-h-lang"><span>{t('interfaceLanguage')}</span></h4>
   <div className="panel-card" role="radiogroup" aria-labelledby="ac-h-lang" onKeyDown={arrows}>{languages.map(item=><button key={item.key} type="button" className="panel-row" role="radio" id={`ac-lang-${item.key}`} aria-checked={item.key===language} tabIndex={item.key===language?0:-1} disabled={pending} onClick={()=>{ if(item.key!==language) save('language',item.key); }}>
    <span className="panel-row__text"><span className="panel-row__t lang-native" lang={item.key} dir={item.key==='ar'?'rtl':'ltr'}>{t(item.name)}</span><span className="panel-row__d">{t(item.description)}</span></span>
    {item.key===language&&<span className="panel-row__meta"><SettingsIcon name="check"/></span>}
   </button>)}</div>
   <p className="set-hint">{t('settingsChatsStayArabic')}</p>
   {error&&<p className="set-err" role="alert">{error}</p>}
  </section>
 </>;
}

type Agent={id:string,name:string,is_default:boolean};
async function manage(company:string,intent:'default'|'remove',agent:string) {
 try {
  const response=await fetch('/api/hermes-agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,intent,agent})});
  if(response.ok) return '';
  return ((await response.json()) as {error?:string}).error||'hermesAgentFailed';
 } catch { return 'hermesAgentFailed'; }
}

// "Make it main" (reference: mainSetHTML) for the Owner; the server checks the role again (manage_hermes_agent).
export function MakeMain({company,agent,current}:{company:string,agent:Agent,current:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsMakeMain')}</span><span className="panel-row__d">{t('settingsMakeMainD',current)}</span>{error&&<span className="set-err" role="alert">{t(error)}</span>}</span>
  <button type="button" className="btn btn--secondary btn--sm" id="set-make-main" disabled={pending} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'default',agent.id); setError(failure); if(!failure) router.refresh(); })}>{t('settingsMakeMain')}</button></li>;
}

// The danger zone's delete (reference: settingsHTML danger): the name typed again confirms it. It removes the Agent
// from this company only; the main Agent cannot be removed here.
export function DeleteAgent({company,slug,agent}:{company:string,slug:string,agent:Agent}) {
 const {t}=useI18n(); const router=useRouter();
 const [open,setOpen]=useState(false); const [typed,setTyped]=useState('');
 const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <>
  <li className="panel-row"><span className="panel-row__text"><span className="panel-row__t">{t('settingsDelete',agent.name)}</span><span className="panel-row__d">{t('settingsDeleteD')}</span></span>
   <button type="button" className="btn btn--secondary btn--sm" id="danger-delete" aria-expanded={open} onClick={()=>{setOpen(value=>!value);setTyped('');setError('');}}>{t('settingsDeleteButton')}</button></li>
  {open&&<li className="danger-confirm" role="group" aria-label={t('settingsDelete',agent.name)}>
   <p>{t('settingsDeleteConfirm',agent.name)}</p>
   <label className="set-label" htmlFor="del-confirm">{t('settingsDeleteType',agent.name)}</label>
   <input className="set-input" id="del-confirm" type="text" dir="auto" autoComplete="off" value={typed} onChange={event=>setTyped(event.target.value)}/>
   {error&&<p className="set-err" role="alert">{t(error)}</p>}
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" onClick={()=>setOpen(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" id="del-go" disabled={pending||typed.trim()!==agent.name.trim()} onClick={()=>startTransition(async()=>{ const failure=await manage(company,'remove',agent.id); setError(failure); if(!failure) { router.replace(overlayHref(slug,'agents')); router.refresh(); } })}>{t('settingsDeleteGo')}</button></div>
  </li>}
 </>;
}


// The company name (reference: settings Company, name field) for the Owner. The server checks the Owner again
// (/api/company-name, rename_company), so the field is only a convenience.
export function CompanyName({company,name}:{company:string,name:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [value,setValue]=useState(name); const [pending,startTransition]=useTransition(); const [state,setState]=useState<{error?:string,saved?:boolean}>({});
 const save=()=>startTransition(async()=>{
  try {
   const response=await fetch('/api/company-name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,name:value})});
   const body=await response.json() as {name?:string,error?:string};
   if(!response.ok) { setState({error:body.error||'companyNameInvalid'}); return; }
   setValue(body.name||value); setState({saved:true}); router.refresh();
  } catch { setState({error:'companyNameInvalid'}); }
 });
 const trimmed=value.trim();
 return <form className="co-name-form" onSubmit={event=>{event.preventDefault(); save();}}>
  <div className="co-name"><input className="set-input" id="co-name" name="name" type="text" dir="auto" maxLength={80} required autoComplete="organization" aria-describedby="co-name-status" value={value} onChange={event=>{setValue(event.target.value); setState({});}}/>
   <button type="submit" className="btn btn--primary btn--sm" disabled={pending||!trimmed||trimmed===name.trim()}>{t('save')}</button></div>
  <p id="co-name-status" className={state.error?'set-err':'set-hint'} role={state.error?'alert':'status'}>{state.error?t(state.error):state.saved?t('companyNameSaved'):null}</p>
 </form>;
}

// The invitation form of a Company worked alone (reference: inviteFormHTML): the chosen Role's description follows the
// select. It posts to the members action, which checks the Owner again and returns to the overlay.
export function InviteForm({slug,company,roles}:{slug:string,company:string,roles:{key:string,name:string,description:string}[]}) {
 const {t}=useI18n();
 const [role,setRole]=useState('contributor'); const chosen=roles.find(item=>item.key===role)||roles[0];
 return <form className="inv" action={changeMember}>
  <input type="hidden" name="op" value="invite"/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="back" value="settings"/>
  <div className="inv-row">
   <div className="set-field"><label className="set-label" htmlFor="inv-email">{t('settingsInviteEmail')} <span aria-hidden="true">*</span></label>
    <input className="set-input" id="inv-email" name="email" type="email" dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('settingsInviteEmailExample')} required/></div>
   <div className="set-field"><label className="set-label" htmlFor="inv-role">{t('settingsRole')}</label>
    <select className="set-input" id="inv-role" name="role" aria-describedby="inv-role-d" value={role} onChange={event=>setRole(event.target.value)}>{roles.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></div>
   <button type="submit" className="btn btn--primary inv-go">{t('settingsInviteGo')}</button>
  </div>
  <p className="set-hint" id="inv-role-d">{chosen.name}: {chosen.description}</p>
 </form>;
}

// One Member × Agent switch (#15; reference: ta-toggle). It turns at once and goes back, with the reason, when the
// database refuses.
export function AgentSwitch({company,person,agent,on,label}:{company:string,person:string,agent:string,on:boolean,label:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [checked,setChecked]=useState(on); const [pending,startTransition]=useTransition(); const [error,setError]=useState('');
 return <><button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={pending} onClick={()=>startTransition(async()=>{
  const next=!checked; setChecked(next); setError('');
  const failure=await setAgentVisible(company,person,agent,next);
  if(failure) { setChecked(!next); setError(failure); } else router.refresh();
 })}/>{error&&<span className="set-err" role="alert">{t(error)}</span>}</>;
}

// Who told the Agent a rule and when (#18; design-reference: rulesHTML, "Said by Omar · Yesterday · 6:40 PM"), in the
// reader's own time zone once the page has hydrated, as the made line is.
export function RuleSaid({by,at}:{by:string,at:string}) {
 const {t,language}=useI18n(); const zone=useZone();
 const day=dayOf(at,zone); const today=dayOf(new Date().toISOString(),zone);
 const yesterday=new Date(new Date(`${today}T00:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
 const time=dateFormatter(localeFor(language),{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(at));
 const when=day===today?`${t('logToday')} · ${time}`:day===yesterday?`${t('logYesterday')} · ${time}`:madeDay(at,language,zone);
 return <span className="panel-row__d rl-said" data-utc={zone}>{t('settingsRuleSaidBy',by,when)}</span>;
}

// An Owner's or a Manager's quiet "Remove" on one rule (#18), drawn like the reference's "Forget this" on a memory note.
// The server checks the role again (remove_agent_rule). Focus moves to the next rule's Remove, or to the list's heading
// when none is left, before the row goes.
export function RemoveRule({company,rule,body}:{company:string,rule:string,body:string}) {
 const {t}=useI18n(); const router=useRouter();
 const [pending,startTransition]=useTransition(); const [failed,setFailed]=useState(false);
 const remove=(button:HTMLButtonElement)=>startTransition(async()=>{
  setFailed(false);
  const removed=await fetch('/api/agent-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,rule})}).then(response=>response.ok,()=>false);
  if(!removed) { setFailed(true); return; }
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.rl-remove')]; const at=buttons.indexOf(button);
  (buttons[at+1]||buttons[at-1]||document.getElementById('rl-h'))?.focus();
  router.refresh();
 });
 return <span className="rl-act">{failed&&<span className="set-err" role="alert">{t('settingsRuleRemoveFailed')}</span>}
  <button type="button" className="link-btn rl-remove" disabled={pending} aria-label={t('settingsRuleRemoveLabel',body.length>40?`${body.slice(0,40)}…`:body)} onClick={event=>remove(event.currentTarget)}>{t('settingsRuleRemove')}</button></span>;
}
