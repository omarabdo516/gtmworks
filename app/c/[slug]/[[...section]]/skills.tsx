import { getI18n } from '@/lib/i18n-server';
import { roleAgents } from '@/lib/role-agents';
import { AgentRoleFace } from '@/components/agent-role-face';
import { skillLibrary } from '@/lib/skill-library.mjs';
import en from '@/lib/messages/skills.en.json';
import ar from '@/lib/messages/skills.ar.json';
import { installSkill, setSkillEnabled } from './skill-actions';
type Version={version:number,name:string,description:string,permissions:string[]};
type Skill={id:string,slug:string,source:string,skill_versions:Version[]};
type Agent={agent_id:string,role:string};
const problems:Record<string,string>={install_script:'skillProblemInstallScript',too_large:'skillProblemTooLarge',no_frontmatter:'skillProblemNoFrontmatter',bad_name:'skillProblemBadName',no_description:'skillProblemNoDescription',no_permissions:'skillProblemNoPermissions',unknown_permission:'skillProblemUnknownPermission'};
const sources:Record<string,string>={library:'skillSourceLibrary',upload:'skillSourceUpload',team:'skillSourceTeam'};
// A server component: it ships no client JavaScript, which the route size budget counts. Its own strings live in skills.en.json and
// skills.ar.json (checked like the main catalogues) because the main ones are bundled for the browser and main has no budget left.
export default async function Skills({company,slug,skills,enabled,agents,refused,failed}:{company:string,slug:string,skills:Skill[],enabled:{skill_id:string,agent_id:string}[],agents:Agent[],refused?:string,failed?:boolean}) { const {t,language}=await getI18n(); const text:Record<string,string>=language==='ar'?ar:en; const s=(key:string,...values:unknown[])=>text[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const hidden=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/></>;
 const reasons=(refused || '').split(',').filter(code=>problems[code]);
 const granted=roleAgents.flatMap(role=>{const agent=agents.find(item=>item.role===role.key); return agent?[{id:agent.agent_id,role,name:t(role.name)}]:[];});
 const row=(skill:Skill)=>{ const latest=[...skill.skill_versions].sort((a,b)=>b.version-a.version)[0]; if(!latest) return null;
  return <div key={skill.id} className="detail-row" aria-label={skill.slug} role="group"><div className="agent-row-main">
   <strong dir="auto">{latest.name}</strong><p dir="auto">{latest.description}</p>
   <p>{s(sources[skill.source])}{' · '}{s('skillVersion',latest.version)}{' · '}{s('skillPermissions')}{' '}<span dir="ltr">{latest.permissions.join(', ') || s('skillNoPermissions')}</span></p>
   <ul>{granted.length===0?<li>{t('noAgentsYet')}</li>:granted.map(agent=>{ const on=enabled.some(item=>item.skill_id===skill.id && item.agent_id===agent.id);
    return <li key={agent.id}><form action={setSkillEnabled} className="detail-row agent-key-row" aria-label={`${skill.slug} ${agent.name}`}>{hidden}<input type="hidden" name="skill" value={skill.id}/><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value={on?'disable':'enable'}/>
     <AgentRoleFace agent={agent.role}/><div className="agent-row-main"><strong>{agent.name}</strong><p>{on?s('skillEnabled'):s('skillNotEnabled')}</p></div>
     <button className="button" aria-label={on?s('disableSkillFor',skill.slug,agent.name):s('enableSkillFor',skill.slug,agent.name)}>{on?s('disableSkill'):s('enableSkill')}</button></form></li>;})}</ul>
  </div></div>; };
 const outside=skills.filter(skill=>skill.source!=='team'); const written=skills.filter(skill=>skill.source==='team');
 return <>
  {(reasons.length>0||failed)&&<section className="panel agent-notice" role="alert">{failed?<p>{s('skillCouldNotBeChanged')}</p>:<><p>{s('skillNotInstalled')}</p><ul>{reasons.map(code=><li key={code}>{s(problems[code])}</li>)}</ul></>}</section>}
  <section className="panel agents-panel section-title skills-controls"><h2>{s('installedSkills')}</h2><p>{s('skillsAreInstructionsInSkillMd')}</p>
   <form action={installSkill} className="agent-create-form">{hidden}<input type="hidden" name="source" value="upload"/><label>{s('skillFile')}{' '}<input name="file" type="file" accept=".md,text/markdown" required/></label><button className="button">{s('installSkill')}</button></form>
   <div className="detail-rows">{outside.length===0?<p className="empty">{t('noSkillsYet')}</p>:outside.map(row)}</div></section>
  <section className="panel agents-panel section-title skills-controls"><h2>{s('skillLibrary')}</h2><p>{s('installAReadyMadeSkillInOneClick')}</p>
   <div className="detail-rows">{skillLibrary.map(entry=>{ const installed=skills.some(skill=>skill.slug===entry.name);
    return <form key={entry.name} action={installSkill} className="detail-row agent-key-row" aria-label={entry.name}>{hidden}<input type="hidden" name="source" value="library"/><input type="hidden" name="entry" value={entry.name}/>
     <div className="agent-row-main"><strong dir="auto">{entry.name}</strong><p dir="auto">{entry.description}</p></div>
     {installed?<span>{s('skillInstalled')}</span>:<button className="button" aria-label={s('installSkillNamed',entry.name)}>{s('installSkill')}</button>}</form>;})}</div></section>
  <section className="panel agents-panel section-title skills-controls"><h2>{s('mySkills')}</h2><p>{s('skillsTheTeamWrote')}</p>
   <form action={installSkill} className="agent-webhook-form">{hidden}<input type="hidden" name="source" value="team"/><label>{s('skillText')}{' '}<textarea className="field" name="content" dir="ltr" rows={8} required/></label><button className="button">{s('saveSkill')}</button></form>
   <div className="detail-rows">{written.length===0?<p>{s('noSkillsWrittenYet')}</p>:written.map(row)}</div></section>
 </>;
}
