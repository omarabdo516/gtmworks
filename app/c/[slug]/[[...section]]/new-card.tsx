'use client';
import { useRef, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { roleAgents } from '@/lib/role-agents';
import { MemberPicker, type WorkMember } from '@/lib/work-activity';
import { CardDialog } from '@/app/card-dialog';
import { workAction } from './work-actions';
function Send({ready}:{ready:boolean}) { const {t}=useI18n(); const {pending}=useFormStatus(); return <button className="primary" disabled={!ready||pending}>{t('createCard')}</button>; }
// Loaded only when a new card is started, so the board's first load stays small.
// stage 0 is a message to an agent; a stage id is the quick form of that column (title and template).
export default function NewCard({slug,company,agents:roster,members,stage,fromRoute,onClose}:{slug:string,company:string,agents:{person_id:string,role:string,granted:boolean}[],members:WorkMember[],stage:number,fromRoute:boolean,onClose:()=>void}) { const {t}=useI18n();
 // One key per opened composer: a double click or a retried request is one card. The form cannot submit before React attaches its handler.
 const key=useRef(''); const hydrated=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 const agents=roleAgents.flatMap(role=>roster.filter(a=>a.granted&&a.role===role.key).map(a=>({person_id:a.person_id,people:{name:members.find(member=>member.person_id===a.person_id)?.people?.name||t(role.name)}})));
 const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/></>;
 const cancel=fromRoute&&!stage?<Link className="button" href={`/c/${slug}/work/board`}>{t('cancel')}</Link>:<button type="button" onClick={onClose}>{t('cancel')}</button>;
 return <CardDialog creating title={t('newCard')} returnTo={fromRoute?`/c/${slug}/work/board`:undefined} onClose={onClose}>{stage?
  <form action={workAction}>{hidden('create')}<input type="hidden" name="stage" value={stage}/><label>{t('cardTitle')}<input dir="auto" className="field" required name="title"/></label><label>{t('template')}<select className="field" name="template"><option value="">{t('blankCard')}</option><option value="carosel">{t('carouselTemplate')}</option><option value="static">{t('designTemplate')}</option><option value="reel">{t('reelTemplate')}</option></select></label><Send ready/> {cancel}</form>:
  <form action={form=>{key.current||=crypto.randomUUID(); form.set('key',key.current); return workAction(form);}}>{hidden('request')}
   {!agents.length&&<p role="alert" className="work-error">{t('noAgentsYet')}</p>}
   <label>{t('cardMessage')}<textarea dir="auto" className="field" required name="message"/></label>
   <label>{t('attachFiles')}<input className="field" type="file" name="files" multiple/></label>
   <label>{t('cardAgent')}<MemberPicker label={t('cardAgent')} name="agent" members={agents}/></label>
   <label>{t('cardMode')}<select className="field" name="mode" defaultValue="plan"><option value="plan">{t('modePlan')}</option><option value="do">{t('modeDo')}</option><option value="answer">{t('modeAnswer')}</option></select></label>
   <Send ready={hydrated&&agents.length>0}/> {cancel}
  </form>}</CardDialog>;
}
