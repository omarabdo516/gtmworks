import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { agentsMainFirst, memoryAgent, overlayHref } from '@/lib/settings-overlay.mjs';
import { knowledgeParts, pickPart } from '@/lib/company-knowledge.mjs';
import { SettingsIcon } from './settings-icons';
import { KnowledgeText } from './settings-section-parts';

// The Company knowledge section of the settings overlay (#27; design-reference: sovKnowHTML): how it differs from an
// Agent's memory, one tab per part (?section=knowledge&part=<key>), and the chosen part with who last edited it and the
// Agents that read it. The text is the shared Skill company-knowledge in the Engine (#344), read for a Member only; who
// last edited the part is the Company's log, read with the reader's own session (RLS). An Owner or a Manager gets the
// editor, and check_company_knowledge checks the Role again. The text keeps its own direction.
// What gtmworks stores of the chosen part: its last edit and the Agents the reader sees. The overlay reads it with its
// other database reads, before its first byte (#898); the text is the Engine's, read by the browser after the section is
// drawn (ADR 0030: app/settings-section-parts.tsx).
export type KnowledgeStored=Awaited<ReturnType<typeof readKnowledgeStored>>;
export async function readKnowledgeStored(db:Awaited<ReturnType<typeof supabase>>,company:string,requested?:string) {
 const part=pickPart(requested);
 const [{data:edit,error},{data:agentRows}]=await Promise.all([
  db.from('company_log').select('actor_name,created_at').eq('company_id',company).eq('action','company_knowledge_changed').eq('details->>part',part).order('id',{ascending:false}).limit(1).maybeSingle(),
  db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company).order('name')]);
 if(error) console.error('Company knowledge: last edit not read:',company,error.message);
 return {part,edit:error?false as const:edit?{actor_name:edit.actor_name as string|null,created_at:edit.created_at as string}:null,agents:agentsMainFirst(agentRows||[])};
}

export async function CompanyKnowledge({slug,company,canManage,stored:{part,edit,agents},asked}:{slug:string,company:string,canManage:boolean,stored:KnowledgeStored,asked:number}) {
 const {t}=await getI18n();
 const title=t(knowledgeParts.find(([key])=>key===part)![1]);
 // The Agents this reader sees (RLS): a Member is not told of an Agent hidden from them.
 // "Open the memory of {Agent}" (#193): the first Agent the reader sees that is not the main one, else the main Agent.
 const memAgent=memoryAgent(agents);
 return <>
  <div className="know-vs"><div className="know-vs__c"><b><SettingsIcon name="book"/>{t('settingsKnowledge')}</b><p>{t('settingsKnowCompanyD')}</p></div>
   <div className="know-vs__c"><b><SettingsIcon name="bulb"/>{t('settingsKnowMemory')}</b><p>{t('settingsKnowMemoryD')}</p>
    {memAgent&&<Link className="link-btn" href={overlayHref(slug,'agents',{agent:memAgent.id,tab:'memory'})}>{t('knowOpenMemory',memAgent.name)}</Link>}</div></div>
  <div className="od-rail know-tabs" role="group" aria-label={t('knowPages')}>{knowledgeParts.map(([key,label])=>
   <Link key={key} replace className="chip" id={`know-tab-${key}`} href={overlayHref(slug,'knowledge',{part:key})} aria-pressed={key===part}>{t(label)}</Link>)}</div>
  <KnowledgeText company={company} part={part} title={title} canManage={canManage} edit={edit} agents={agents.map(agent=>({id:agent.id}))} asked={asked}/>
 </>;
}
