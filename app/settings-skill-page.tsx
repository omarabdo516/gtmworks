import type { i18n } from '@/lib/i18n.mjs';
import type { CompanySkillPage } from '@/lib/company-skill-page.mjs';
import { Head } from './settings-overlay-parts';
import { SkillBack } from './settings-overlay-frame';
import { skillLines } from '@/lib/skill-text.mjs';

// One learned Skill's page in Settings › Learning (#181; design-reference: sovSkillHTML, 7271-7303). The pinned Engine
// has no management route over the Skill ledger (engine.md): its own text is all there is, so the page draws one column
// under Steps, not the reference's Before and After, with no version, no Why and no restore. The Skill's name heads the
// page, the line under it names whose Skill it is with that Agent's learning mode (#28), and Back returns to Learning.
// Opened from the learned Skill's row on the Agent's page (#180) and from the Learning list.
type T = ReturnType<typeof i18n>['t'];
const modeKey = { auto: 'settingsLearnOnItsOwn', ask: 'settingsLearnAsks', mixed: 'settingsLearnMixed' } as const;

export function SkillPage({t,slug,rtl,data}:{t:T,slug:string,rtl:boolean,data:CompanySkillPage}) {
 const lines = data.state === 'found' ? skillLines(data.content) : [];
 return <>
  <SkillBack slug={slug} agent={data.agent.id} skill={data.skill} rtl={rtl}/>
  <Head title={data.skill}/>
  <div className="sk-who"><span>{t('settingsSkillPageOf', data.agent.name)}{data.mode && <> · {t(modeKey[data.mode])}</>}</span></div>
  {data.state !== 'found'
   ? <div className="panel-card"><p className="panel-empty">{t('settingsSkillPageUnread')}</p></div>
   : <div className="sk-diff sk-diff--one"><section className="sk-col is-cur" aria-labelledby="sk-h-steps">
      <h4 id="sk-h-steps">{t('settingsSkillSteps')}</h4>
      <ol>{lines.map((line, index) => <li key={index} dir="auto">{line}</li>)}</ol>
     </section></div>}
 </>;
}
