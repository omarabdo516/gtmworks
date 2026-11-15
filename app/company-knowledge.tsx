import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { agentsMainFirst, overlayHref } from '@/lib/settings-overlay.mjs';
import { knowledgeBlocks, knowledgeParts, pickPart } from '@/lib/company-knowledge.mjs';
import { SettingsIcon } from './settings-icons';
import { KnowledgeEditedAt, KnowledgeEditor } from './settings-lazy';

type Stored={body:string,edited_at:string,editor:{name:string|null}|null};

// The Company knowledge section of the settings overlay (#27; design-reference: sovKnowHTML): how it differs from an
// Agent's memory, one tab per part (?section=knowledge&part=<key>), and the chosen part with who last edited it and the
// Agents that read it. Every Member reads it with their own session (RLS); an Owner or a Manager gets the editor, and
// save_company_knowledge checks the Role again. The text keeps its own direction.
export async function CompanyKnowledge({slug,company,canManage,part:requested}:{slug:string,company:string,canManage:boolean,part?:string}) {
 const {t}=await getI18n(); const db=await supabase();
 const part=pickPart(requested);
 const title=t(knowledgeParts.find(([key])=>key===part)![1]);
 const [{data,error},{data:agentRows}]=await Promise.all([
  db.from('company_knowledge').select('body,edited_at,editor:people!edited_by(name)').eq('company_id',company).eq('part',part).maybeSingle(),
  db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company).order('name')]);
 // An unread part is never shown as empty: saving over it would replace text the editor never saw.
 if(error) throw new Error('Could not load the Company knowledge');
 const stored=data as unknown as Stored|null; const body=stored?.body||'';
 // The Agents this reader sees (RLS): a Member is not told of an Agent hidden from them.
 const agents=agentsMainFirst(agentRows||[]);
 const editor=stored?.editor?.name||t('member');
 const content=stored&&body?<>
  <p className="know-meta"><span className="me__av" aria-hidden="true">{editor.trim().slice(0,1).toUpperCase()}</span>
   <span>{t('knowLastEdited')} <bdi>{editor}</bdi> · <KnowledgeEditedAt at={stored.edited_at}/></span>
   {agents.length>0&&<><span aria-hidden="true">·</span><span className="fstack" aria-hidden="true">{agents.map(agent=><CompanyAgentFace key={agent.id} agent={agent} size={18}/>)}</span>
    <span>{t('knowReadBy')} (<span className="num">{agents.length}</span>)</span></>}</p>
  <div className="know-body" dir="auto">{knowledgeBlocks(body).map((block,index)=>block.kind==='p'?<p key={index}>{block.text}</p>
   :<ul key={index} className="know-ul">{block.items.map((item,at)=><li key={at}>{item}</li>)}</ul>)}</div>
 </>:<p className="panel-empty know-empty">{t(canManage?'knowEmptyManage':'knowEmptyRead')}</p>;
 return <>
  <div className="know-vs"><div className="know-vs__c"><b><SettingsIcon name="book"/>{t('settingsKnowledge')}</b><p>{t('settingsKnowCompanyD')}</p></div>
   <div className="know-vs__c"><b><SettingsIcon name="bulb"/>{t('settingsKnowMemory')}</b><p>{t('settingsKnowMemoryD')}</p></div></div>
  <div className="od-rail know-tabs" role="group" aria-label={t('knowPages')}>{knowledgeParts.map(([key,label])=>
   <Link key={key} replace className="chip" id={`know-tab-${key}`} href={overlayHref(slug,'knowledge',{part:key})} aria-pressed={key===part}>{t(label)}</Link>)}</div>
  {canManage?<KnowledgeEditor key={part} company={company} part={part} title={title} body={body}>{content}</KnowledgeEditor>
   :<article className="know-page" aria-labelledby="know-h"><div className="know-page__top"><h4 className="know-page__h" id="know-h">{title}</h4></div>{content}</article>}
 </>;
}
