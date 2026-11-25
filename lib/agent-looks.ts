import type { AgentLook } from './agent-look';
import type { KeptLook } from './agent-look-saves';

// Every look of a Company (public.agent_looks, ADR 0027), read once per page and given to every face under it
// (lib/agent-looks-client: LooksProvider). Every Member reads every look, a hidden or removed Agent's included, so a
// record that outlived its Agent and a shared channel show the face everyone sees. A request's card asks by the id its
// Agent will have. `removed` names each removed Agent by the name kept beside its look (#702), so a record that keeps
// only its id names it too; a living Agent is never named here. `kept` holds what the database keeps of each (the look
// given, the picks, when it changed), so the Owner's window knows what is automatic (#698); a page of sample faces (the
// ready-made gallery) has none.
export type CompanyLooks={agents:Record<string,AgentLook>,requests:Record<string,string>,removed:Record<string,string>,kept?:Record<string,KeptLook>};
export const noLooks:CompanyLooks={agents:{},requests:{},removed:{}};

type LookRow={agent_id:string,request_id:number|null,shape:AgentLook['shape'],colour:AgentLook['colour'],temperament:AgentLook['temperament'],
 auto_shape:AgentLook['shape'],auto_colour:AgentLook['colour'],auto_temperament:AgentLook['temperament'],
 picked_shape:AgentLook['shape']|null,picked_colour:AgentLook['colour']|null,picked_temperament:AgentLook['temperament']|null,changed_at:string|null,kept_name:string|null};
const lookColumns='agent_id,request_id,shape,colour,temperament,kept_name,auto_shape,auto_colour,auto_temperament,picked_shape,picked_colour,picked_temperament,changed_at';
// A row as the window keeps it.
export function keptOf(row:Omit<LookRow,'agent_id'|'request_id'|'kept_name'>):KeptLook {
 const picked:Partial<AgentLook>={};
 if(row.picked_shape) picked.shape=row.picked_shape;
 if(row.picked_colour) picked.colour=row.picked_colour;
 if(row.picked_temperament) picked.temperament=row.picked_temperament;
 return {automatic:{shape:row.auto_shape,colour:row.auto_colour,temperament:row.auto_temperament},picked,changedAt:row.changed_at};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyLooks(db:any,company:string|undefined):Promise<CompanyLooks> {
 if(!company) return noLooks;
 const {data,error}=await db.from('agent_looks').select(lookColumns).eq('company_id',company);
 // A failed read draws every face plain, and the page goes on.
 if(error||!data) return noLooks;
 const looks:Required<CompanyLooks>={agents:{},requests:{},removed:{},kept:{}};
 for(const row of data as LookRow[]) {
  looks.agents[row.agent_id]={shape:row.shape,colour:row.colour,temperament:row.temperament};
  looks.kept[row.agent_id]=keptOf(row);
  if(row.request_id!=null) looks.requests[String(row.request_id)]=row.agent_id;
  if(row.kept_name) looks.removed[row.agent_id]=row.kept_name;
 }
 return looks;
}
