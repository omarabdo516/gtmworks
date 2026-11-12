'use client';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/paperclip/EmptyState';
import { useI18n } from '@/lib/i18n-client';
import { projectAction } from './project-actions';
const projectStatuses=['active','paused','done'] as const;
type Project={id:number,name:string,goal:string,status:string};
// A saved form is reset by React after its action, so each control is keyed on the saved value: it then remounts with that value instead of falling back to the one it had when the page first loaded.
// Work > Projects: the company's projects with their goal and status. Filing cards into a project happens on the card; the board and list filter by it.
export default function Projects({slug,company,projects,counts,canEdit,message}:{slug:string,company:string,projects:Project[],counts:Record<number,number>,canEdit:boolean,message?:string}) { const {t}=useI18n();
 const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/></>;
 const status=(s:string)=>s==='paused'?t('projectPaused'):s==='done'?t('projectDone'):t('projectActive');
 return <section className="panel">{message&&<p role="alert" className="work-error">{message}</p>}
  {canEdit&&<form action={projectAction} className="settings-row" aria-label={t('newProject')}>{hidden('create')}<input dir="auto" required name="name" aria-label={t('projectName')} placeholder={t('projectName')}/><input dir="auto" name="goal" aria-label={t('goal')} placeholder={t('goal')}/><button className="primary">{t('createProject')}</button></form>}
  {!projects.length&&<EmptyState icon={Inbox} message={t('noProjectsYet')}/>}
  {projects.map(p=>canEdit?<form action={projectAction} className="settings-row" key={p.id} aria-label={p.name}>{hidden('update')}<input type="hidden" name="project" value={p.id}/><input key={p.name} dir="auto" required name="name" aria-label={t('projectName')} defaultValue={p.name}/><input key={p.goal} dir="auto" name="goal" aria-label={t('goal')} defaultValue={p.goal}/><select key={p.status} name="status" aria-label={t('projectStatus')} defaultValue={p.status}>{projectStatuses.map(s=><option key={s} value={s}>{status(s)}</option>)}</select><span>{t('projectCards',counts[p.id]||0)}</span><button>{t('save')}</button></form>:<div className="settings-row" key={p.id}><strong dir="auto">{p.name}</strong><span dir="auto">{p.goal}</span><span>{status(p.status)}</span><span>{t('projectCards',counts[p.id]||0)}</span></div>)}
 </section>;
}
