import { getI18n } from '@/lib/i18n-server';
import type { SkillAgent } from '@/lib/company-skills.mjs';
import en from '@/lib/messages/skills.en.json';
import ar from '@/lib/messages/skills.ar.json';
import { writeSkill } from './skill-actions';
const problems:Record<string,string>={invalid:'skillProblemHeader',shared:'skillProblemShared',notOwn:'skillProblemNotOwn'};
// A server component: it ships no client JavaScript, which keeps page weight down (#55). Its own strings live in skills.en.json and
// skills.ar.json (checked like the main catalogues) because the main ones are bundled for the browser and main has no budget left.
// Skills live only in each Agent's profile in the Engine (#343); agents is null when the Engine cannot be read now.
export default async function Skills({company,slug,agents,refused,failed}:{company:string,slug:string,agents:SkillAgent[]|null,refused?:string,failed?:boolean}) { const {t,language}=await getI18n(); const text:Record<string,string>=language==='ar'?ar:en; const s=(key:string)=>text[key];
 const hidden=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/></>;
 const reason=refused&&problems[refused];
 const own=(agents||[]).filter(agent=>agent.own);
 const choose=<label>{s('skillAgent')}{' '}<select className="field" name="agent" required>{own.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>;
 return <>
  {(reason||failed)&&<section className="panel agent-notice" role="alert">{failed?<p>{s('skillCouldNotBeChanged')}</p>:<><p>{s('skillNotInstalled')}</p><ul><li>{s(reason as string)}</li></ul></>}</section>}
  <section className="panel agents-panel section-title skills-controls"><h2>{s('installedSkills')}</h2><p>{s('skillsAreInstructionsInSkillMd')}</p>
   {own.length>0&&<form action={writeSkill} className="agent-create-form">{hidden}{choose}<label>{s('skillFile')}{' '}<input name="file" type="file" accept=".md,text/markdown" required/></label><button className="button">{s('installSkill')}</button></form>}
   <div className="detail-rows">{agents===null?<p className="empty">{s('skillsNotRead')}</p>:agents.length===0?<p className="empty">{t('noAgentsYet')}</p>:agents.map(agent=>
    <div key={agent.id} className="detail-row" aria-label={agent.name} role="group"><div className="agent-row-main"><strong dir="auto">{agent.name}</strong>
     {agent.skills===null?<p>{s('skillsNotRead')}</p>:agent.skills.length===0?<p className="empty">{t('noSkillsYet')}</p>:
      <ul>{agent.skills.map(skill=><li key={skill.name}><span dir="ltr">{skill.name}</span>{skill.shared&&<>{' · '}{s('skillShared')}</>}</li>)}</ul>}
    </div></div>)}</div></section>
  {own.length>0&&<section className="panel agents-panel section-title skills-controls"><h2>{s('mySkills')}</h2><p>{s('skillsTheTeamWrote')}</p>
   <form action={writeSkill} className="agent-webhook-form">{hidden}{choose}<label>{s('skillText')}{' '}<textarea className="field" name="content" dir="ltr" rows={8} required/></label><button className="button">{s('saveSkill')}</button></form></section>}
 </>;
}
