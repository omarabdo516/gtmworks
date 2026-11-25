import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { AgentFace } from '@/components/agent-face';
import { agentsMainFirst, memoryAgent, overlayHref } from '@/lib/settings-overlay.mjs';
import { knowledgeBlocks, knowledgeParts, pickPart } from '@/lib/company-knowledge.mjs';
import { readKnowledge } from '@/lib/company-knowledge-skill.mjs';
import { signInTarget } from '@/lib/company-sign-in.mjs';
import { SettingsIcon } from './settings-icons';
import { KnowledgeEditedAt, KnowledgeEditor } from './settings-lazy';

// The Company knowledge section of the settings overlay (#27; design-reference: sovKnowHTML): how it differs from an
// Agent's memory, one tab per part (?section=knowledge&part=<key>), and the chosen part with who last edited it and the
// Agents that read it. The text is the shared Skill company-knowledge in the Engine (#344), read for a Member only; who
// last edited the part is the Company's log, read with the reader's own session (RLS). An Owner or a Manager gets the
// editor, and check_company_knowledge checks the Role again. The text keeps its own direction.
export async function CompanyKnowledge({slug,company,canManage,part:requested}:{slug:string,company:string,canManage:boolean,part?:string}) {
 const {t}=await getI18n(); const db=await supabase();
 const part=pickPart(requested);
 const title=t(knowledgeParts.find(([key])=>key===part)![1]);
 const [read,{data:edit,error},{data:agentRows}]=await Promise.all([
  signInTarget(db,company).catch(()=>null).then(hermes=>readKnowledge(hermes,company)),
  db.from('company_log').select('actor_name,created_at').eq('company_id',company).eq('action','company_knowledge_changed').eq('details->>part',part).order('id',{ascending:false}).limit(1).maybeSingle(),
  db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company).order('name')]);
 // An unread part is never shown as empty: saving over it would replace text the editor never saw. When the Engine does
 // not answer, the part says it cannot be read, with no editor, and the rest of Settings stays as it is (#630). A last
 // edit that cannot be read leaves out only who made it.
 const unread=!read.parts;
 if(error) console.error('Company knowledge: last edit not read:',company,error.message);
 const body=read.parts?.[part]||'';
 // The Agents this reader sees (RLS): a Member is not told of an Agent hidden from them.
 const agents=agentsMainFirst(agentRows||[]);
 // "Open the memory of {Agent}" (#193): the first Agent the reader sees that is not the main one, else the main Agent.
 const memAgent=memoryAgent(agents);
 const editor=edit?.actor_name||t('member');
 const content=unread?<div className="panel-card"><p className="panel-empty know-unread">{t('knowUnread')}</p></div>:body?<>
  <p className="know-meta">{!error&&<><span className="me__av" aria-hidden="true">{editor.trim().slice(0,1).toUpperCase()}</span>
   <span>{t('knowLastEdited')} <bdi>{editor}</bdi>{edit&&<> · <KnowledgeEditedAt at={edit.created_at}/></>}</span></>}
   {agents.length>0&&<>{!error&&<span aria-hidden="true">·</span>}<span className="fstack" aria-hidden="true">{agents.map(agent=><AgentFace key={agent.id} agent={agent.id} size={18}/>)}</span>
    <span>{t('knowReadBy')} (<span className="num">{agents.length}</span>)</span></>}</p>
  <div className="know-body" dir="auto">{knowledgeBlocks(body).map((block,index)=>block.kind==='p'?<p key={index}>{block.text}</p>
   :<ul key={index} className="know-ul">{block.items.map((item,at)=><li key={at}>{item}</li>)}</ul>)}</div>
 </>:<p className="panel-empty know-empty">{t(canManage?'knowEmptyManage':'knowEmptyRead')}</p>;
 return <>
  <div className="know-vs"><div className="know-vs__c"><b><SettingsIcon name="book"/>{t('settingsKnowledge')}</b><p>{t('settingsKnowCompanyD')}</p></div>
   <div className="know-vs__c"><b><SettingsIcon name="bulb"/>{t('settingsKnowMemory')}</b><p>{t('settingsKnowMemoryD')}</p>
    {memAgent&&<Link className="link-btn" href={overlayHref(slug,'agents',{agent:memAgent.id,tab:'memory'})}>{t('knowOpenMemory',memAgent.name)}</Link>}</div></div>
  <div className="od-rail know-tabs" role="group" aria-label={t('knowPages')}>{knowledgeParts.map(([key,label])=>
   <Link key={key} replace className="chip" id={`know-tab-${key}`} href={overlayHref(slug,'knowledge',{part:key})} aria-pressed={key===part}>{t(label)}</Link>)}</div>
  {canManage&&!unread?<KnowledgeEditor key={part} company={company} part={part} title={title} body={body}>{content}</KnowledgeEditor>
   :<article className="know-page" aria-labelledby="know-h"><div className="know-page__top"><h4 className="know-page__h" id="know-h">{title}</h4></div>{content}</article>}
 </>;
}
