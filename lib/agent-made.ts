// When an Agent Lead made was made and at whose request (#13). An Agent made before, or attached by hand, has no
// requester and shows nothing.
export type Made={at:string,by:string,mine:boolean};
export const madeColumns='created_at,requested_by,requester_opened_at,requester:people!requested_by(name)';
export const madeOf=(agent:{created_at?:string|null,requested_by?:string|null,requester?:unknown},person:string):Made|null=>
 agent.created_at&&agent.requested_by?{at:agent.created_at,by:(agent.requester as {name?:string|null}|null)?.name||'',mine:agent.requested_by===person}:null;
