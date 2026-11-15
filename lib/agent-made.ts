// When an Agent Lead made was made and at whose request (#13), and, for the person who asked, the Conversation they
// asked in (`ask`, a link; RLS lets only that Conversation's person read it). An Agent made before, or attached by
// hand, has no requester and shows nothing.
export type Made={at:string,by:string,mine:boolean,ask:string|null};
export const madeColumns='created_at,requested_by,requester_opened_at,requester:people!requested_by(name),lead_made_agents(conversation_id)';
export const madeOf=(agent:{created_at?:string|null,requested_by?:string|null,requester?:unknown,lead_made_agents?:unknown},person:string,slug:string):Made|null=>{
 const asked=(agent.lead_made_agents as {conversation_id:string}[]|null|undefined)?.[0]?.conversation_id;
 return agent.created_at&&agent.requested_by?{at:agent.created_at,by:(agent.requester as {name?:string|null}|null)?.name||'',mine:agent.requested_by===person,ask:asked?`/c/${slug}/conversations/${asked}`:null}:null;
};
