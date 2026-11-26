'use client';
import { useState, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { overlayHref, usageTotals, usageModels, usageHeaviest, usageEmpty } from '@/lib/settings-overlay.mjs';
import { knowledgeBlocks } from '@/lib/company-knowledge.mjs';
import type { UsageRow } from '@/lib/company-app-items';
import type { CompanyLearning } from '@/lib/company-learning.mjs';
import type { CompanySkillPage } from '@/lib/company-skill-page.mjs';
import type { AgentRoutines } from '@/lib/agent-routines.mjs';
import { Head, Label } from './settings-overlay-parts';
import { SettingsIcon } from './settings-icons';
import { LearningSection } from './settings-learning';
import { SkillPage } from './settings-skill-page';
import { RoutinesSection } from './settings-routines';
import { KnowledgeEditedAt, KnowledgeEditor } from './settings-lazy';
import { UsageTable, UsageModels } from './usage-tables';
import { partUrl, useSettingsPart, type PartRead } from './settings-part-read';

// The parts of Settings' Company sections that the Engine backs (#898, ADR 0030): the work sandbox's state, usage,
// learning and a learned Skill's page, Routines and the Company knowledge text. Each section is drawn at once from what
// gtmworks stores, and each part fills in when its own read lands (app/settings-part-read.ts), keeping its last good read
// when the Engine does not answer.
const always=()=>true;
const noRoutines:AgentRoutines[]=[];
const found=(data:{state?:string}|null|undefined)=>data?.state==='found';
const reading=(read:PartRead<unknown>)=>read.state==='reading'&&!read.kept;
function ReadingLine() { const {t}=useI18n(); return <div className="panel-card"><p className="panel-empty set-part-reading" role="status">{t('settingsPartReading')}</p></div>; }

// The Company's work sandbox not answering (#398): one plain state in the existing notice style, and no control. The
// Engine itself not answering leaves this unread; the models section names that.
export function SandboxNote({company,asked}:{company:string,asked:number}) {
 const {t}=useI18n();
 const read=useSettingsPart<{state:string}>(partUrl(company,'sandbox'),asked,always);
 return read.data?.state==='notRunning'?<p className="ro-note sov-warn" role="note" id="co-sandbox"><SettingsIcon name="shield"/><span>{t('workSandboxNotRunning')}</span></p>:null;
}

// The token use of the period, from each Company's Agents' profiles (#347, #32): the Owner and the Managers see every
// Company they manage.
export function UsagePart({slug,company,period,asked}:{slug:string,company:string,period:7|30,asked:number}) {
 const {t,locale}=useI18n();
 const read=useSettingsPart<UsageRow[]>(partUrl(company,'usage',{period:String(period)}),asked,Array.isArray);
 const rows=read.data??[];
 const seg=<div className="segmented use-seg" role="group" aria-label={t('settingsPeriod')}>{([[7,'settingsLast7'],[30,'settingsLast30']] as const).map(([days,label])=><Link key={days} replace href={overlayHref(slug,'usage',days===30?{period:'30'}:{})} aria-pressed={period===days} id={`use-p-${days}`}>{t(label)}</Link>)}</div>;
 const head=<Head title={t('usage')} info={t('settingsUsageSub')} extra={seg}/>;
 if(reading(read)) return <>{head}<ReadingLine/></>;
 const totals=usageTotals(rows,company);
 const models=usageModels(rows,company);
 const heaviest=usageHeaviest(rows,company);
 const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 // A profile two Agents share is one row with both names, as the reference names each Agent on the profile.
 const heaviestName=heaviest?new Intl.ListFormat(locale,{type:'unit'}).format(heaviest.agents.map(agent=>agent.name)):'—';
 const kpi=(label:string,value:ReactNode)=><div className="kpi"><span className="kpi__label">{label}</span><span className="kpi__val num">{value}</span></div>;
 return <>{head}
  {usageEmpty(rows)?<div className="panel-card"><p className="panel-empty">{t('usageNone')}</p></div>:<>
   <div className="kpis use-kpis">{kpi(t('settingsTokens'),count(totals.tokens))}{kpi(t('usageSessions'),count(totals.sessions))}{kpi(t('usageHeaviest'),<bdi>{heaviestName}</bdi>)}</div>
   <section className="dp-sec" aria-labelledby="use-h"><Label id="use-h">{t('settingsPerAgent')}</Label>
    <div className="sov-ta"><UsageTable t={t} locale={locale} rows={rows}/></div></section>
   {/* Each model's own count, apart from the totals: Hermes merges auxiliary usage into these rows (#32). */}
   {models.length>0&&<section className="dp-sec" aria-labelledby="use-h-model"><Label id="use-h-model">{t('settingsPerModel')}</Label>
    <div className="sov-ta"><UsageModels t={t} locale={locale} models={models}/></div></section>}
  </>}</>;
}

// How each Agent learns, and what it learned (#28): its mode from its own Engine profile, its rules, the Skills the
// Engine's learning graph marks, and the Company's lessons. A read that fails leaves the service's own refusal on the
// page, never an empty mode.
export function LearningPart({slug,company,canManage,owner,asked}:{slug:string,company:string,canManage:boolean,owner:boolean,asked:number}) {
 const {t}=useI18n();
 const read=useSettingsPart<CompanyLearning>(partUrl(company,'learning'),asked,found);
 return <LearningSection t={t} slug={slug} company={company} canManage={canManage} owner={owner} data={read.data??null} readAt={read.readAt||asked} reading={reading(read)}/>;
}

// One learned Skill's page (#181); a Skill this person has no page for opens Learning instead.
export function SkillPagePart({slug,company,agent,skill,canManage,owner,asked}:{slug:string,company:string,agent:string,skill:string,canManage:boolean,owner:boolean,asked:number}) {
 const {t,language}=useI18n();
 const read=useSettingsPart<CompanySkillPage|null>(partUrl(company,'skillPage',{agent,skill}),asked,always);
 if(reading(read)) return <><Head title={skill}/><ReadingLine/></>;
 return read.data?<SkillPage t={t} slug={slug} rtl={language==='ar'} data={read.data}/>:<LearningPart slug={slug} company={company} canManage={canManage} owner={owner} asked={asked}/>;
}

// Every Routine of every Agent the reader sees (#31), read from each Agent's own Engine profile; gtmworks keeps no copy.
export function RoutinesPart({company,canManage,asked}:{company:string,canManage:boolean,asked:number}) {
 const {t}=useI18n();
 const [now]=useState(()=>new Date().toISOString());
 const read=useSettingsPart<{state:'found'|'noEngine'|'failed'|'invalid',agents:AgentRoutines[]|null}>(partUrl(company,'routines'),asked,data=>data?.state==='found'||data?.state==='noEngine');
 if(reading(read)) return <><Head title={t('settingsRoutines')} info={t('settingsRoutinesSub')}/><ReadingLine/></>;
 return <RoutinesSection company={company} state={read.data?.state??'failed'} agents={read.data?.agents??noRoutines} canManage={canManage} now={now}/>;
}

// The chosen part of the Company knowledge (#27): its text is the shared Skill company-knowledge in the Engine (#344),
// read here; who last edited it and the Agents that read it are the database's, drawn with the section. An unread part
// is never shown as empty: saving over it would replace text the editor never saw. When the Engine does not answer, the
// part says it cannot be read, with no editor, and the rest of Settings stays as it is (#630).
export function KnowledgeText({company,part,title,canManage,edit,agents,asked}:{company:string,part:string,title:string,canManage:boolean,edit:{actor_name:string|null,created_at:string}|null|false,agents:{id:string}[],asked:number}) {
 const {t}=useI18n();
 const read=useSettingsPart<{state:string,parts:Record<string,string>|null}>(partUrl(company,'knowledge'),asked,data=>data?.parts!=null);
 const article=(content:ReactNode)=><article className="know-page" aria-labelledby="know-h"><div className="know-page__top"><h4 className="know-page__h" id="know-h">{title}</h4></div>{content}</article>;
 if(reading(read)) return article(<ReadingLine/>);
 const parts=read.data?.parts;
 const body=parts?.[part]||'';
 // A last edit that cannot be read (`false`) leaves out only who made it.
 const editor=edit&&edit.actor_name||t('member');
 const content=!parts?<div className="panel-card"><p className="panel-empty know-unread">{t('knowUnread')}</p></div>:body?<>
  <p className="know-meta">{edit!==false&&<><span className="me__av" aria-hidden="true">{editor.trim().slice(0,1).toUpperCase()}</span>
   <span>{t('knowLastEdited')} <bdi>{editor}</bdi>{edit&&<> · <KnowledgeEditedAt at={edit.created_at}/></>}</span></>}
   {agents.length>0&&<>{edit!==false&&<span aria-hidden="true">·</span>}<span className="fstack" aria-hidden="true">{agents.map(agent=><AgentFace key={agent.id} agent={agent.id} size={18}/>)}</span>
    <span>{t('knowReadBy')} (<span className="num">{agents.length}</span>)</span></>}</p>
  <div className="know-body" dir="auto">{knowledgeBlocks(body).map((block,index)=>block.kind==='p'?<p key={index}>{block.text}</p>
   :<ul key={index} className="know-ul">{block.items.map((item,at)=><li key={at}>{item}</li>)}</ul>)}</div>
 </>:<p className="panel-empty know-empty">{t(canManage?'knowEmptyManage':'knowEmptyRead')}</p>;
 return canManage&&parts?<KnowledgeEditor key={part} company={company} part={part} title={title} body={body}>{content}</KnowledgeEditor>:article(content);
}
