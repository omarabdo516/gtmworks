'use client';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/paperclip/EmptyState';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { projectAction } from './project-actions';
const projectStatuses=['active','paused','done'] as const;
type Project={id:number,name:string,goal:string,status:string};
// Work > Projects: the company's projects with their goal and status. Filing cards into a project happens on the card; the board and list filter by it.
export default function Projects({slug,company,projects,counts,canEdit,message}:{slug:string,company:string,projects:Project[],counts:Record<number,number>,canEdit:boolean,message?:string}) { const {t}=useI18n();
 const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/></>;
 const status=(s:string)=>s==='paused'?t('projectPaused'):s==='done'?t('projectDone'):t('projectActive');
 return <section className="panel">{message&&<p role="alert" className="work-error">{message}</p>}
  {canEdit&&<form action={projectAction} className="settings-row" aria-label={t('newProject')}>{hidden('create')}<input dir="auto" required name="name" aria-label={t('projectName')} placeholder={t('projectName')}/><input dir="auto" name="goal" aria-label={t('goal')} placeholder={t('goal')}/><button className="primary">{t('createProject')}</button></form>}
  {!projects.length&&<EmptyState icon={Inbox} message={t('noProjectsYet')}/>}
  {projects.map(p=>canEdit?<ProjectRow key={p.id} project={p} cards={counts[p.id]||0} hidden={hidden('update')} status={status}/>:<div className="settings-row" key={p.id}><strong dir="auto">{p.name}</strong><span dir="auto">{p.goal}</span><span>{status(p.status)}</span><span>{t('projectCards',counts[p.id]||0)}</span></div>)}
 </section>;
}

// One project's form. React resets an action's form when the action ends, and each control then shows its default
// value. The page drawn again after the save normally brings the saved values, but it may land after the reset, or be
// replaced by an older copy of the page that was being prepared at the same moment; the controls then fell back to
// the values from before the save. So the row keeps what it saved and shows it until the page brings newer values
// than the ones it had when the save began. Each control is keyed on the value it shows, so it is drawn again with it.
function ProjectRow({project,cards,hidden,status}:{project:Project,cards:number,hidden:React.ReactNode,status:(s:string)=>string}) { const {t}=useI18n();
 const [saved,setSaved]=useState<{from:Project,values:Project}|null>(null);
 const same=(a:Project,b:Project)=>a.name===b.name&&a.goal===b.goal&&a.status===b.status;
 const shown=saved&&same(saved.from,project)?saved.values:project;
 const save=async(form:FormData)=>{
  const from=project;
  await projectAction(form); // a refused save leaves this page with its message, so only a stored one goes on
  setSaved({from,values:{...project,name:String(form.get('name')||'').trim(),goal:String(form.get('goal')||'').trim(),status:String(form.get('status'))}});
 };
 return <form action={save} className="settings-row" aria-label={shown.name}>{hidden}<input type="hidden" name="project" value={project.id}/><input key={shown.name} dir="auto" required name="name" aria-label={t('projectName')} defaultValue={shown.name}/><input key={shown.goal} dir="auto" name="goal" aria-label={t('goal')} defaultValue={shown.goal}/><select key={shown.status} name="status" aria-label={t('projectStatus')} defaultValue={shown.status}>{projectStatuses.map(s=><option key={s} value={s}>{status(s)}</option>)}</select><span>{t('projectCards',cards)}</span><button>{t('save')}</button></form>;
}
