import type { i18n } from '@/lib/i18n.mjs';
import type { CompanyLearning, LearningAgent } from '@/lib/company-learning.mjs';
import Link from '@/lib/link';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { Head, Label } from './settings-overlay-parts';
import { FocusReturn } from './settings-overlay-frame';
import { CompanyLearningMode, AgentLearningMode, RuleActions } from './settings-lazy';
import { SettingsIcon } from './settings-icons';

// Settings › Learning (#28; design-reference: sovLearnHTML, lnRowHTML): the Company's mode and each Agent's, what each
// Agent learned (its rules, with Forget this and Bring it back, and the Skills the Engine says it learned on its own),
// the Company's shared lessons, and the two lists of what an Agent changes by itself and only with the Owner's OK. The
// Owner changes the mode; the Owner and Managers forget and restore a rule; everyone who may open the section reads it.
// A learned Skill's row opens its own page (#181); it shows no restore, because the pinned Engine has no management route
// over its Skill ledger (the PR names the gap).
type T=ReturnType<typeof i18n>['t'];
const modeKey={auto:'settingsLearnOnItsOwn',ask:'settingsLearnAsks',mixed:'settingsLearnMixed'} as const;

// The Company's mode is what its Agents' profiles agree on: one mode when every Agent reads it, mixed when an Agent has
// its own, and unknown when a profile could not be read.
function companyModeOf(agents:LearningAgent[]|null):'auto'|'ask'|'mixed'|null {
 if(!agents?.length) return null;
 const modes=agents.map(agent=>agent.mode);
 if(modes.some(mode=>mode===null)) return null;
 return modes.every(mode=>mode===modes[0])?modes[0]:'mixed';
}

export function LearningSection({t,slug,company,canManage,owner,data}:{t:T,slug:string,company:string,canManage:boolean,owner:boolean,data:CompanyLearning|null}) {
 const found=data?.state==='found'?data:null;
 const agents=found?.agents??null;
 const rules=found?.rules??[];
 const lessons=found?.lessons??[];
 const learned=agents?.flatMap(agent=>(agent.learned??[]).map(skill=>({agent,skill})))??[];
 const companyMode=companyModeOf(agents);
 const total=rules.length+learned.length;
 const agentName=(id:string)=>agents?.find(agent=>agent.id===id)?.name||null;
 return <>
  <Head title={t('settingsLearning')} sub={t('settingsLearningSub')}/>
  {!canManage&&<p className="ro-note"><SettingsIcon name="shield"/><span>{t('settingsRO')}</span></p>}
  {/* The Engine stages a note or Skill write in "Asks first", but its management listener has no route that lists
      them; the section says what the mode does and draws no list this version cannot read. */}
  <section className="dp-sec ln-sugg" aria-labelledby="ln-h-sug"><Label id="ln-h-sug">{t('settingsLearnSuggestions')}</Label>
   <p className="set-hint">{t('settingsLearnSuggestHint')}</p></section>
  <section className="dp-sec" aria-labelledby="ln-h-co"><Label id="ln-h-co">{t('settingsLearnCompany')}</Label>
   {!agents?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :<><CompanyLearningMode company={company} mode={companyMode} canChange={owner}/>
     <p className="set-hint">{companyMode==='mixed'?t('settingsLearnMixed'):t('settingsLearnTapHint')}</p></>}</section>
  <section className="dp-sec" aria-labelledby="ln-h-per"><Label id="ln-h-per">{t('settingsLearnPerAgent')}</Label>
   {!agents?<div className="panel-card"><p className="panel-empty">{t('settingsLearnUnread')}</p></div>
    :agents.length===0?<div className="panel-card"><p className="panel-empty">{t('noAgentsYet')}</p></div>
    :<div className="panel-card">{agents.map(agent=><div className="panel-row ln-ag" key={agent.id}>
      <span className="panel-row__text"><span className="panel-row__t" id={`ln-ag-t-${agent.id}`}><bdi>{agent.name}</bdi></span>
       <span className="panel-row__d">{agent.mode?t(modeKey[agent.mode]):t('settingsLearnUnread')}</span></span>
      {owner&&agent.own&&!agent.shared&&agent.mode?<AgentLearningMode company={company} agent={agent.id} labelId={`ln-ag-t-${agent.id}`} mode={agent.mode}/>:null}
     </div>)}</div>}</section>
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
  <section className="dp-sec" aria-labelledby="ln-h-rules"><Label id="ln-h-rules">{t('settingsLearnRules')}</Label>
   <div className="ln-rules">
    <div className="panel-card ln-rule"><b><SettingsIcon name="bulb"/>{t('settingsLearnChangesAuto')}</b>
     <ul><li>{t('settingsLearnNotes')}</li><li>{t('settingsLearnSkills')}</li></ul>
     <p className="set-hint">{t('settingsLearnAskHint')}</p></div>
    <div className="panel-card ln-rule"><b><SettingsIcon name="shield"/>{t('settingsLearnChangesOwner')}</b>
     <ul><li>{t('settingsLearnModel')}</li><li>{t('settingsLearnTools')}</li><li>{t('settingsLearnInstructions')}</li></ul>
     <p className="set-hint">{t('settingsLearnOwnerHint')}</p></div>
   </div></section>
  <FocusReturn prefix="ln-see-"/>
 </>;
}
