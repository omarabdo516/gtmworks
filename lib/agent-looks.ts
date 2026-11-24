import type { AgentLook } from './agent-look';

// Every look of a Company (public.agent_looks, ADR 0027), read once per page and given to every face under it
// (lib/agent-looks-client: LooksProvider). Every Member reads every look, a hidden or removed Agent's included, so a
// record that outlived its Agent and a shared channel show the face everyone sees. A request's card asks by the id its
// Agent will have.
export type CompanyLooks={agents:Record<string,AgentLook>,requests:Record<string,string>};
export const noLooks:CompanyLooks={agents:{},requests:{}};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyLooks(db:any,company:string|undefined):Promise<CompanyLooks> {
 if(!company) return noLooks;
 const {data,error}=await db.from('agent_looks').select('agent_id,request_id,shape,colour,temperament').eq('company_id',company);
 // A failed read draws every face plain, and the page goes on.
 if(error||!data) return noLooks;
 const looks:CompanyLooks={agents:{},requests:{}};
 for(const row of data as ({agent_id:string,request_id:number|null}&AgentLook)[]) {
  looks.agents[row.agent_id]={shape:row.shape,colour:row.colour,temperament:row.temperament};
  if(row.request_id!=null) looks.requests[String(row.request_id)]=row.agent_id;
 }
 return looks;
}
