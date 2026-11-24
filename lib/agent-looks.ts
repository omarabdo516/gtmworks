import type { AgentLook } from './agent-look';

// Every look of a Company (public.agent_looks, ADR 0027), read once per page and given to every face under it
// (lib/agent-looks-client: LooksProvider). Every Member reads every look, a hidden or removed Agent's included, so a
// record that outlived its Agent and a shared channel show the face everyone sees. A request's card asks by the id its
// Agent will have. `removed` names each removed Agent by the name kept beside its look (#702), so a record that keeps
// only its id names it too; a living Agent is never named here.
export type CompanyLooks={agents:Record<string,AgentLook>,requests:Record<string,string>,removed:Record<string,string>};
export const noLooks:CompanyLooks={agents:{},requests:{},removed:{}};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyLooks(db:any,company:string|undefined):Promise<CompanyLooks> {
 if(!company) return noLooks;
 const {data,error}=await db.from('agent_looks').select('agent_id,request_id,shape,colour,temperament,kept_name').eq('company_id',company);
 // A failed read draws every face plain, and the page goes on.
 if(error||!data) return noLooks;
 const looks:CompanyLooks={agents:{},requests:{},removed:{}};
 for(const row of data as ({agent_id:string,request_id:number|null,kept_name:string|null}&AgentLook)[]) {
  looks.agents[row.agent_id]={shape:row.shape,colour:row.colour,temperament:row.temperament};
  if(row.request_id!=null) looks.requests[String(row.request_id)]=row.agent_id;
  if(row.kept_name) looks.removed[row.agent_id]=row.kept_name;
 }
 return looks;
}
