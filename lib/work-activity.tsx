'use client';
import { useState, useSyncExternalStore } from 'react';
import { AgentFace } from '@/components/agent-face';
import { useAgentIdentities } from './agent-identities-client';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/paperclip/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { workDate } from './work-date.mjs';
import { roleAgents } from './role-agents';
import { isThumbnail } from './attachments.mjs';
export type WorkMember={person_id:string,agent_role?:string|null,people:{name:string}|null};
export type WorkActivity={id:number,card_id:number,action:string,details:Record<string,unknown>,created_at:string,actor_id:string|null,evidence:string|null,evidence_url?:string|null};
function useAgentIdentity(id:string|null,members:WorkMember[]) {
 const identity=useAgentIdentities().find(agent=>agent.id===id);
 const member=members.find(member=>member.person_id===id);
 return identity||(member?.agent_role?{id:member.person_id,role:member.agent_role,name:member.people?.name||''}:undefined);
}
export function Avatar({id,members,nameVisible=false}:{id:string|null,members:WorkMember[],nameVisible?:boolean}) { const {t}=useI18n(); const agent=useAgentIdentity(id,members); const member=members.find(member=>member.person_id===id); const name=agent?.name||member?.people?.name||t('member'); return agent?<AgentFace {...agent} name={name}/>:<span dir="auto" className="avatar" title={name} role="img" aria-label={name} aria-hidden={nameVisible||undefined}>{member?.people?.name?.slice(0,1)||'؟'}</span>; }
export function MemberPicker({members,name,label,defaultValue,empty}:{members:WorkMember[],name:string,label:string,defaultValue?:string,empty?:string}) {
 const {language}=useI18n();
 const [choice,setValue]=useState(defaultValue);
 const value=members.find(member=>member.person_id===choice)?.person_id??(empty?'':members[0]?.person_id||'');
 const selected=members.find(member=>member.person_id===value);
 return <><input type="hidden" name={name} value={value}/><DropdownMenu dir={language==='ar'?'rtl':'ltr'}>
  <DropdownMenuTrigger asChild><button type="button" className="member-picker" aria-label={label}>{selected&&<Avatar id={value} members={members} nameVisible/>}<bdi>{selected?.people?.name||empty||label}</bdi><ChevronDown size={16} aria-hidden="true"/></button></DropdownMenuTrigger>
  <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={value} onValueChange={setValue}>
   {empty&&<DropdownMenuRadioItem className="member-option" value="">{empty}</DropdownMenuRadioItem>}
   {members.map(member=><DropdownMenuRadioItem className="member-option" key={member.person_id} value={member.person_id} aria-label={member.people?.name} textValue={member.people?.name||''}><Avatar id={member.person_id} members={members} nameVisible/><bdi>{member.people?.name}</bdi></DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup></DropdownMenuContent>
 </DropdownMenu></>;
}
const fields:Record<string,string>={title:'title',offering:'offering',segment:'segment',hook:'hook',channel:'channel',format:'format',go_live:'publishingDate',goal:'goal',caption:'caption',next_actor:'nextActor'};
export function activityText(a:WorkActivity, t: import('@/lib/i18n.mjs').I18n['t'], language:import('@/lib/i18n.mjs').Language) { const d=a.details||{}; if(a.action==='approval_approved') return t('approvedTheCard', d.step); if(a.action==='approval_rejected') return t('rejectedTheCard', d.step, d.reason, d.caption?t('captionPart'):'', d.design?t('design'):''); if(a.action==='approval_skipped') return t('skippedTheRemovedApprovalStep', d.step); if(a.action==='card_changed') { const field=String(d.field); if(field==='stage_id') return t('movedTheCardFromTo', d.old_name||t('stage'), d.new_name||t('stage')); if(field==='project_id') return d.new_name?t('filedTheCardInProject', d.new_name):t('tookTheCardOutOfItsProject'); if(field==='go_live') return t('updatedPublishingDate', workDate(typeof d.new==='string'?d.new:null,language)); return t('updated', fields[field]?t(fields[field]):t('card'), d.new && !['next_actor','caption'].includes(field)?`: ${String(d.new)}`:''); } return ({card_created:t('createdTheCard'),checklist_changed:t('updatedTheChecklist'),label_changed:t('updatedLabels'),assignee_changed:t('updatedAssignees'),creative_added:t('addedADesign'),version_added:t('addedADesignVersion'),comment_added:t('addedAComment')} as Record<string,string>)[a.action]||t('updatedTheCard'); }
function Evidence({a}:{a:WorkActivity}) { const {t}=useI18n(); return a.evidence?(a.evidence_url?<p><a href={a.evidence_url} target="_blank" rel="noreferrer">{t('viewEvidenceFile')}</a></p>:/^https?:\/\//i.test(a.evidence)?<p><a href={a.evidence} target="_blank" rel="noreferrer">{t('viewEvidence')}</a></p>:<p>{t('attachedFile')}</p>):null; }
const never=()=>()=>{};
// The server cannot know the viewer's time zone, so it and the first browser render both draw UTC, hidden (globals.css);
// once hydrated the zone is the viewer's own and the time shows.
function ActivityTime({value}:{value:string}) { const {language}=useI18n(); const zone=useSyncExternalStore(never,()=>undefined,()=>'UTC'); return <time dateTime={value} data-utc={zone}>{workDate(value,language,{hour:'2-digit',minute:'2-digit',timeZone:zone})}</time>; }
export function ActivityRow({activity:a,members,slug,showCard=false}:{activity:WorkActivity,members:WorkMember[],slug:string,showCard?:boolean}) { const {t,language}=useI18n(); const identity=useAgentIdentity(a.actor_id,members); const name=identity?.name||members.find(m=>m.person_id===a.actor_id)?.people?.name||t('member'); const d=a.details||{}; return <div className="detail-row"><Avatar id={a.actor_id} members={members} nameVisible/><div><strong dir="auto">{name}</strong><p>{activityText(a,t,language)}{showCard&&<> · <Link className="link" href={`/c/${slug}/work/board/${a.card_id}`}>{t('viewCard')}</Link></>}</p>{a.action==='comment_added'&&typeof d.body==='string'&&<p dir="auto" className="comment-body">{d.body}</p>}<ActivityTime value={a.created_at}/><Evidence a={a}/></div></div>; }
// One message in a card's conversation: who wrote it, whether that was a person or an agent (an agent in its role colour), and the text in its own direction.
export type WorkAttachment={id:number,card_id:number,comment_id:number,name:string,content_type:string};
export const isMessage=(a:WorkActivity)=>a.action==='comment_added'&&typeof a.details?.body==='string';
export function MessageRow({activity:a,members,files=[],slug=''}:{activity:WorkActivity,members:WorkMember[],files?:WorkAttachment[],slug?:string}) { const {t}=useI18n(); const agent=useAgentIdentity(a.actor_id,members); const name=agent?.name||members.find(m=>m.person_id===a.actor_id)?.people?.name||t('member'); const color=agent?roleAgents.find(r=>r.key===agent.role)?.color:undefined; return <li className="detail-row message" data-author={agent?'agent':'person'}><Avatar id={a.actor_id} members={members} nameVisible/><div><strong dir="auto">{name}</strong><span className="author-chip" style={color?{borderColor:color}:undefined}>{color&&<i style={{background:color}}/>}{agent?t('agentLabel'):t('personLabel')}</span><p dir="auto" className="comment-body">{String(a.details.body)}</p>{files.length>0&&<ul className="attachments">{files.map(f=>{ const href=`/c/${slug}/files/${f.id}`; return <li key={f.id}>{isThumbnail(f.content_type)?<a href={href} target="_blank" rel="noreferrer"><img src={href} alt={f.name}/></a>:<a dir="auto" href={href}>{f.name}</a>}</li>; })}</ul>}<ActivityTime value={a.created_at}/><Evidence a={a}/></div></li>; }
