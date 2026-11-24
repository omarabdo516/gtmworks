import type { i18n } from '@/lib/i18n.mjs';
import type { CompanyLearning } from '@/lib/company-learning.mjs';
import Link from '@/lib/link';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { Head, Label } from './settings-overlay-parts';
import { FocusReturn } from './settings-overlay-frame';
import { LearningModes, RuleActions } from './settings-lazy';
import { SettingsIcon } from './settings-icons';

// Settings › Learning (#28; design-reference: sovLearnHTML, lnRowHTML): the Company's mode and each Agent's, what each
// Agent learned (its rules, with Forget this and Bring it back, and the Skills the Engine says it learned on its own),
// the Company's shared lessons, and the two lists of what an Agent changes by itself and only with the Owner's OK. The
// Owner changes the mode; the Owner and Managers forget and restore a rule; everyone who may open the section reads it.
// A learned Skill's row opens its own page (#181); it shows no restore, because the pinned Engine has no management route
// over its Skill ledger (the PR names the gap).
type T=ReturnType<typeof i18n>['t'];

export function LearningSection({t,slug,company,canManage,owner,data,readAt}:{t:T,slug:string,company:string,canManage:boolean,owner:boolean,data:CompanyLearning|null,readAt:number}) {
 const found=data?.state==='found'?data:null;
 const agents=found?.agents??null;
 const rules=found?.rules??[];
 const lessons=found?.lessons??[];
 const learned=agents?.flatMap(agent=>(agent.learned??[]).map(skill=>({agent,skill})))??[];
 const total=rules.length+learned.length;
 const agentName=(id:string)=>agents?.find(agent=>agent.id===id)?.name||null;
 return <>
  <Head title={t('settingsLearning')} info={t('settingsLearningSub')}/>
  {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>}
  {/* The Engine stages a note or Skill write in "Asks first", but its management listener has no route that lists
      them; the section says what the mode does and draws no list this version cannot read. */}
  <section className="dp-sec ln-sugg" aria-labelledby="ln-h-sug"><Label id="ln-h-sug" info={t('settingsLearnSuggestHint')}>{t('settingsLearnSuggestions')}</Label></section>
  {/* The Company's mode and each Agent's are drawn on the page, so a saved mode is held there with no read (#663). Only
      the fields the modes need cross to the page, not each Agent's learned Skills. */}
  <LearningModes company={company} owner={owner} readAt={readAt} agents={agents?.map(({id,name,own,shared,mode,follow})=>({id,name,own,shared,mode,follow}))??null}/>
  <section className="dp-sec" aria-labelledby="ln-h-rec"><Label id="ln-h-rec">{t('settingsLearnRecent')}{total>0&&<> <span className="muted num">{total}</span></>}</Label>
   {!found?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :total===0?<div className="panel-card"><p className="panel-empty">{t('settingsLearnNone')}</p></div>
    :<ol className="panel-card ln-list">
     {rules.map(rule=><li key={rule.id} className={`ln-row${rule.removed?' is-off':''}`}>
      <span className="ln-ic" aria-hidden="true"><SettingsIcon name="bulb"/></span>
      <div className="ln-body"><p className="ln-t" dir="auto">{rule.body}</p>
       <p className="ln-meta"><span>{t('settingsLearnKindRule')}</span><span aria-hidden="true">·</span>
        <span className="ln-who"><bdi>{agentName(rule.agent)||t('member')}</bdi></span><span aria-hidden="true">·</span>
        <span><bdi>{rule.saidByName||t('member')}</bdi></span>
        {rule.removed&&<><span aria-hidden="true">·</span><span className="badge"><SettingsIcon name="x"/>{t('settingsLearnForgotten')}</span></>}</p>
       {canManage&&<RuleActions company={company} rule={rule.id} body={rule.body} removed={rule.removed}/>}
      </div></li>)}
     {learned.map(({agent,skill})=><li key={`${agent.id}:${skill.name}`} className="ln-row">
      <span className="ln-ic" aria-hidden="true"><SettingsIcon name="spark"/></span>
      <div className="ln-body"><p className="ln-t" dir="ltr">{skill.name}</p>
       <p className="ln-meta"><span>{t('settingsLearnKindSkill')}</span><span aria-hidden="true">·</span>
        <span className="ln-who"><bdi>{agent.name}</bdi></span><span aria-hidden="true">·</span>
        <span className="sk-learned"><SettingsIcon name="spark"/><span>{t('settingsSkillLearned')}</span></span></p>
       {skill.description&&<p className="panel-row__d" dir="auto">{skill.description}</p>}
       <div className="ln-acts"><Link className="link-btn" id={`ln-see-${agent.id}:${skill.name}`} href={overlayHref(slug,'learning',{agent:agent.id,skill:skill.name})}>{t('settingsSkillSeeSteps')}</Link></div>
      </div></li>)}
    </ol>}</section>
  <section className="dp-sec" aria-labelledby="ln-h-lessons"><Label id="ln-h-lessons">{t('settingsLearnLessons')}{lessons.length>0&&<> <span className="muted num">{lessons.length}</span></>}</Label>
   {!found?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :lessons.length===0?<div className="panel-card"><p className="panel-empty">{t('settingsLearnNoLessons')}</p></div>
    :<ul className="panel-card ln-list">{lessons.map(lesson=><li key={lesson.id} className="ln-row">
      <span className="ln-ic" aria-hidden="true"><SettingsIcon name="check"/></span>
      <div className="ln-body"><p className="ln-t" dir="auto">{lesson.body}</p>
       <p className="ln-meta"><span>{t('settingsLearnKindRule')}</span><span aria-hidden="true">·</span><span><bdi>{lesson.saidByName||t('member')}</bdi></span></p>
      </div></li>)}</ul>}</section>
  <section className="dp-sec" aria-labelledby="ln-h-rules"><Label id="ln-h-rules" info={<><span className="info__p">{t('settingsLearnAskHint')}</span><span className="info__p">{t('settingsLearnOwnerHint')}</span></>}>{t('settingsLearnRules')}</Label>
   <div className="ln-rules">
    <div className="panel-card ln-rule"><b><SettingsIcon name="bulb"/>{t('settingsLearnChangesAuto')}</b>
     <ul><li>{t('settingsLearnNotes')}</li><li>{t('settingsLearnSkills')}</li></ul></div>
    <div className="panel-card ln-rule"><b><SettingsIcon name="shield"/>{t('settingsLearnChangesOwner')}</b>
     <ul><li>{t('settingsLearnModel')}</li><li>{t('settingsLearnTools')}</li><li>{t('settingsLearnInstructions')}</li></ul></div>
   </div></section>
  <FocusReturn prefix="ln-see-"/>
 </>;
}
